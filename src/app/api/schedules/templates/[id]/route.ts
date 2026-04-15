import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import {
  getManageableDepartments,
  hasFullScheduleManagementAccess
} from '@/lib/schedule-management-permissions';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

interface DaySchedule {
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime: number;
}

interface WeeklyTemplate {
  id: number;
  name: string;
  description: string;
  department: string | null;
  createdById: number | null;
  createdByName: string | null;
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
  createdAt?: string;
  updatedAt?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDaySchedule(value: unknown): value is DaySchedule {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    typeof value.shiftType === 'string' &&
    typeof value.startTime === 'string' &&
    typeof value.endTime === 'string' &&
    typeof value.breakTime === 'number'
  );
}

// 資料檔案路徑
const TEMPLATES_FILE = path.join(process.cwd(), 'data', 'weekly-templates.json');

// 確保資料目錄存在
function ensureDataDirectory() {
  const dataDir = path.dirname(TEMPLATES_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 讀取模版資料
function loadTemplates(): WeeklyTemplate[] {
  try {
    ensureDataDirectory();
    if (!fs.existsSync(TEMPLATES_FILE)) {
      return [];
    }
    
    const data = fs.readFileSync(TEMPLATES_FILE, 'utf8');
    const templates = JSON.parse(data);
    return templates.map((t: Partial<WeeklyTemplate> & { id: number; name: string }) => ({
      ...t,
      department: t.department ?? null,
      createdById: t.createdById ?? null,
      createdByName: t.createdByName ?? '系統'
    }));
  } catch (error) {
    console.error('讀取模版失敗:', error);
    return [];
  }
}

// 儲存模版資料
function saveTemplates(templates: WeeklyTemplate[]): void {
  try {
    ensureDataDirectory();
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
  } catch (error) {
    console.error('儲存模版失敗:', error);
  }
}

// 檢查是否可編輯/刪除模版
function canManageTemplate(template: WeeklyTemplate, managedDepartments: string[]): boolean {
  if (template.department === null) return false; // 通用模版只有 ADMIN/HR 可編輯
  return managedDepartments.includes(template.department);
}

// PUT - 更新週模版
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const { id } = await params;
    const templateIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });
    if (!templateIdResult.isValid || templateIdResult.value === null) {
      return NextResponse.json({ error: '無效的模版ID' }, { status: 400 });
    }
    const templateId = templateIdResult.value;
    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的模版資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的模版資料' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name : undefined;
    const description = typeof body.description === 'string' ? body.description : undefined;
    const department = typeof body.department === 'string' ? body.department : body.department === null ? null : undefined;
    const monday = body.monday;
    const tuesday = body.tuesday;
    const wednesday = body.wednesday;
    const thursday = body.thursday;
    const friday = body.friday;
    const saturday = body.saturday;
    const sunday = body.sunday;

    if (!name) {
      return NextResponse.json({ error: '缺少模版名稱' }, { status: 400 });
    }

    // 載入現有模版
    const templates = loadTemplates();
    
    // 找到要更新的模版
    const templateIndex = templates.findIndex((t: WeeklyTemplate) => t.id === templateId);
    if (templateIndex === -1) {
      return NextResponse.json({ error: '找不到指定的模版' }, { status: 404 });
    }

    const existingTemplate = templates[templateIndex];
    const managedDepartments = await getManageableDepartments(user);
    const isAdmin = hasFullScheduleManagementAccess(user);

    // 權限檢查
    if (!isAdmin && !canManageTemplate(existingTemplate, managedDepartments)) {
      return NextResponse.json({ error: '無權限編輯此模版' }, { status: 403 });
    }

    // 檢查部門變更權限
    let newDepartment = existingTemplate.department;
    
    if (department !== undefined) {
      if (department === '' || department === null) {
        if (!isAdmin) {
          return NextResponse.json({ error: '只有管理員可設為通用模版' }, { status: 403 });
        }
        newDepartment = null;
      } else if (!isAdmin && !managedDepartments.includes(department)) {
        return NextResponse.json({ error: '無權限變更為該部門' }, { status: 403 });
      } else {
        newDepartment = department;
      }
    }

    // 驗證每日班表資料
    const weekdays = { monday, tuesday, wednesday, thursday, friday, saturday, sunday };
    for (const [day, schedule] of Object.entries(weekdays)) {
      if (!isDaySchedule(schedule)) {
        return NextResponse.json({ error: `${day} 班表資料格式錯誤` }, { status: 400 });
      }
      if (!schedule.shiftType) {
        return NextResponse.json({ error: `${day} 缺少班別類型` }, { status: 400 });
      }
    }

    // 更新模版
    const updatedTemplate: WeeklyTemplate = {
      ...existingTemplate,
      name,
      description: description || '',
      department: newDepartment,
      monday: monday as DaySchedule,
      tuesday: tuesday as DaySchedule,
      wednesday: wednesday as DaySchedule,
      thursday: thursday as DaySchedule,
      friday: friday as DaySchedule,
      saturday: saturday as DaySchedule,
      sunday: sunday as DaySchedule,
      updatedAt: new Date().toISOString()
    };

    templates[templateIndex] = updatedTemplate;
    saveTemplates(templates);

    return NextResponse.json({ 
      success: true,
      message: '週模版更新成功',
      template: updatedTemplate 
    });
  } catch (error) {
    console.error('更新週模版失敗:', error);
    return NextResponse.json({ error: '更新週模版失敗' }, { status: 500 });
  }
}

// DELETE - 刪除週模版
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const { id } = await params;
    const templateIdResult = parseIntegerQueryParam(id, { min: 1, max: 99999999 });

    if (!templateIdResult.isValid || templateIdResult.value === null) {
      return NextResponse.json({ error: '無效的模版ID' }, { status: 400 });
    }
    const templateId = templateIdResult.value;

    // 載入現有模版
    const templates = loadTemplates();
    
    // 找到要刪除的模版
    const templateIndex = templates.findIndex((t: WeeklyTemplate) => t.id === templateId);
    if (templateIndex === -1) {
      return NextResponse.json({ error: '找不到指定的模版' }, { status: 404 });
    }

    const templateToDelete = templates[templateIndex];
    const managedDepartments = await getManageableDepartments(user);
    const isAdmin = hasFullScheduleManagementAccess(user);

    // 權限檢查
    if (!isAdmin && !canManageTemplate(templateToDelete, managedDepartments)) {
      return NextResponse.json({ error: '無權限刪除此模版' }, { status: 403 });
    }

    // 刪除模版
    templates.splice(templateIndex, 1);
    saveTemplates(templates);

    return NextResponse.json({ 
      success: true,
      message: '週模版刪除成功'
    });
  } catch (error) {
    console.error('刪除週模版失敗:', error);
    return NextResponse.json({ error: '刪除週模版失敗' }, { status: 500 });
  }
}
