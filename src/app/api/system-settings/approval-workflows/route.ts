/**
 * 審核流程設定 API
 * GET: 取得所有審核流程設定
 * PUT: 更新審核流程設定
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

const DEFAULT_FREEZE_REMINDER = {
  id: 0,
  daysBeforeFreeze1: 3,
  daysBeforeFreeze2: 1,
  freezeDayReminderTime: '09:00'
};

const DEADLINE_MODES = new Set(['FIXED', 'FREEZE_BASED']);

type WorkflowUpdateInput = {
  id: number;
  approvalLevel: number;
  requireManager: boolean;
  deadlineMode: string;
  deadlineHours: number | null;
  enableForward: boolean;
  enableCC: boolean;
};

type FreezeReminderInput = {
  daysBeforeFreeze1: number;
  daysBeforeFreeze2: number;
  freezeDayReminderTime: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseWorkflowUpdate(value: unknown): WorkflowUpdateInput | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const id = value.id;
  const approvalLevel = value.approvalLevel;
  const requireManager = value.requireManager;
  const deadlineMode = value.deadlineMode;
  const deadlineHours = value.deadlineHours;
  const enableForward = value.enableForward;
  const enableCC = value.enableCC;

  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return null;
  }

  if (typeof approvalLevel !== 'number' || !Number.isInteger(approvalLevel) || approvalLevel < 1 || approvalLevel > 3) {
    return null;
  }

  if (typeof requireManager !== 'boolean') {
    return null;
  }

  if (typeof deadlineMode !== 'string' || !DEADLINE_MODES.has(deadlineMode)) {
    return null;
  }

  if (deadlineHours !== null && deadlineHours !== undefined) {
    if (typeof deadlineHours !== 'number' || !Number.isInteger(deadlineHours) || deadlineHours < 0) {
      return null;
    }
  }

  if (typeof enableForward !== 'boolean' || typeof enableCC !== 'boolean') {
    return null;
  }

  return {
    id,
    approvalLevel,
    requireManager,
    deadlineMode,
    deadlineHours: deadlineHours === undefined ? null : (deadlineHours as number | null),
    enableForward,
    enableCC,
  };
}

function parseFreezeReminder(value: unknown): FreezeReminderInput | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const daysBeforeFreeze1 = value.daysBeforeFreeze1;
  const daysBeforeFreeze2 = value.daysBeforeFreeze2;
  const freezeDayReminderTime = value.freezeDayReminderTime;

  if (typeof daysBeforeFreeze1 !== 'number' || !Number.isInteger(daysBeforeFreeze1) || daysBeforeFreeze1 < 0) {
    return null;
  }

  if (typeof daysBeforeFreeze2 !== 'number' || !Number.isInteger(daysBeforeFreeze2) || daysBeforeFreeze2 < 0) {
    return null;
  }

  if (typeof freezeDayReminderTime !== 'string' || !isValidTimeValue(freezeDayReminderTime)) {
    return null;
  }

  return {
    daysBeforeFreeze1,
    daysBeforeFreeze2,
    freezeDayReminderTime,
  };
}

// GET: 取得所有審核流程設定
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '僅管理員可存取' }, { status: 403 });
    }

    // 取得所有工作流程
    const workflows = await prisma.approvalWorkflow.findMany({
      orderBy: { id: 'asc' }
    });

    // 取得凍結提醒設定
    const freezeReminder = await prisma.approvalFreezeReminder.findFirst();

    // 取得考勤凍結設定（用於顯示）
    const freezeSettingsRecord = await prisma.systemSettings.findFirst({
      where: { key: 'attendance_freeze' }
    });
    
    let freezeSettings = null;
    if (freezeSettingsRecord?.value) {
      try {
        const parsed = JSON.parse(freezeSettingsRecord.value);
        freezeSettings = {
          freezeDay: parsed.freezeDay || 5,
          freezeTime: parsed.freezeTime || '18:00',
          isEnabled: parsed.isEnabled !== false
        };
      } catch {
        freezeSettings = null;
      }
    }

    return NextResponse.json({
      success: true,
      workflows,
      freezeReminder: freezeReminder ?? DEFAULT_FREEZE_REMINDER,
      freezeSettings
    });

  } catch (error) {
    console.error('取得審核流程設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT: 更新審核流程設定
export async function PUT(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '僅管理員可修改' }, { status: 403 });
    }

    const bodyResult = await safeParseJSON(request);
    if (!bodyResult.success) {
      return NextResponse.json(
        {
          error: bodyResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式',
        },
        { status: 400 }
      );
    }

    const data = bodyResult.data;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const { workflows, freezeReminder } = data;

    const workflowUpdates: WorkflowUpdateInput[] = [];
    if (workflows !== undefined) {
      if (!Array.isArray(workflows)) {
        return NextResponse.json({ error: '工作流程設定格式不正確' }, { status: 400 });
      }

      for (const workflow of workflows) {
        const parsedWorkflow = parseWorkflowUpdate(workflow);
        if (!parsedWorkflow) {
          return NextResponse.json({ error: '工作流程設定格式不正確' }, { status: 400 });
        }

        workflowUpdates.push(parsedWorkflow);
      }
    }

    const parsedFreezeReminder = freezeReminder === undefined
      ? null
      : parseFreezeReminder(freezeReminder);

    if (freezeReminder !== undefined && !parsedFreezeReminder) {
      return NextResponse.json({ error: '凍結提醒設定格式不正確' }, { status: 400 });
    }

    // 更新工作流程
    if (workflowUpdates.length > 0) {
      for (const wf of workflowUpdates) {
        await prisma.approvalWorkflow.update({
          where: { id: wf.id },
          data: {
            approvalLevel: wf.approvalLevel,
            requireManager: wf.requireManager,
            deadlineMode: wf.deadlineMode,
            deadlineHours: wf.deadlineHours,
            enableForward: wf.enableForward,
            enableCC: wf.enableCC
          }
        });
      }
    }

    // 更新凍結提醒設定
    if (parsedFreezeReminder) {
      const existing = await prisma.approvalFreezeReminder.findFirst();
      if (existing) {
        await prisma.approvalFreezeReminder.update({
          where: { id: existing.id },
          data: {
            daysBeforeFreeze1: parsedFreezeReminder.daysBeforeFreeze1,
            daysBeforeFreeze2: parsedFreezeReminder.daysBeforeFreeze2,
            freezeDayReminderTime: parsedFreezeReminder.freezeDayReminderTime
          }
        });
      } else {
        await prisma.approvalFreezeReminder.create({
          data: {
            daysBeforeFreeze1: parsedFreezeReminder.daysBeforeFreeze1,
            daysBeforeFreeze2: parsedFreezeReminder.daysBeforeFreeze2,
            freezeDayReminderTime: parsedFreezeReminder.freezeDayReminderTime
          }
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: '設定已更新'
    });

  } catch (error) {
    console.error('更新審核流程設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
