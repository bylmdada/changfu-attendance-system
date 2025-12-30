/**
 * 審核流程設定 API
 * GET: 取得所有審核流程設定
 * PUT: 更新審核流程設定
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

// GET: 取得所有審核流程設定
export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
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
    let freezeReminder = await prisma.approvalFreezeReminder.findFirst();
    if (!freezeReminder) {
      freezeReminder = await prisma.approvalFreezeReminder.create({
        data: {
          daysBeforeFreeze1: 3,
          daysBeforeFreeze2: 1,
          freezeDayReminderTime: '09:00'
        }
      });
    }

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
      freezeReminder,
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

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '僅管理員可修改' }, { status: 403 });
    }

    const data = await request.json();
    const { workflows, freezeReminder } = data;

    // 更新工作流程
    if (workflows && Array.isArray(workflows)) {
      for (const wf of workflows) {
        await prisma.approvalWorkflow.update({
          where: { id: wf.id },
          data: {
            approvalLevel: wf.approvalLevel,
            requireManager: wf.requireManager,
            deadlineMode: wf.deadlineMode,
            deadlineHours: wf.deadlineHours
          }
        });
      }
    }

    // 更新凍結提醒設定
    if (freezeReminder) {
      const existing = await prisma.approvalFreezeReminder.findFirst();
      if (existing) {
        await prisma.approvalFreezeReminder.update({
          where: { id: existing.id },
          data: {
            daysBeforeFreeze1: freezeReminder.daysBeforeFreeze1,
            daysBeforeFreeze2: freezeReminder.daysBeforeFreeze2,
            freezeDayReminderTime: freezeReminder.freezeDayReminderTime
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
