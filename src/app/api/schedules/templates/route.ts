import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';
import {
  getManageableDepartments,
  hasFullScheduleManagementAccess
} from '@/lib/schedule-management-permissions';
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
  department: string | null; // null = 通用模版（全機構）
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
      // 如果檔案不存在，建立預設模版
      const defaultTemplates: WeeklyTemplate[] = [
        {
          id: 1,
          name: '標準工作週',
          description: '週一到週五A班，週末休息',
          department: null, // 通用模版
          createdById: null,
          createdByName: '系統',
          monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
          sunday: { shiftType: 'rd', startTime: '', endTime: '', breakTime: 0 },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z'
        }
      ];
      saveTemplates(defaultTemplates);
      return defaultTemplates;
    }
    
    const data = fs.readFileSync(TEMPLATES_FILE, 'utf8');
    const templates = JSON.parse(data);
    // 確保舊模版有新欄位
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

// GET - 獲取排程模板列表（依權限過濾）
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const templates = loadTemplates();
    const managedDepartments = await getManageableDepartments(user);
    const isAdmin = hasFullScheduleManagementAccess(user);

    // 過濾模版
    let filteredTemplates = templates;
    if (!isAdmin) {
      filteredTemplates = templates.filter(t => 
        t.department === null || // 通用模版
        managedDepartments.includes(t.department) // 用戶可管理的部門
      );
    }

    return NextResponse.json({
      success: true,
      templates: filteredTemplates,
      managedDepartments: isAdmin ? [] : managedDepartments,
      isAdmin
    });
  } catch (error) {
    console.error('獲取排程模板失敗:', error);
    return NextResponse.json(
      { success: false, error: '獲取排程模板失敗', templates: [] },
      { status: 500 }
    );
  }
}

// POST - 建立新的週模版
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

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

    // 取得用戶資訊
    const employee = await prisma.employee.findUnique({
      where: { id: user.employeeId },
      select: { name: true, department: true }
    });

    // 權限檢查
    const managedDepartments = await getManageableDepartments(user);
    const isAdmin = hasFullScheduleManagementAccess(user);

    // 決定模版部門
    let templateDepartment: string | null = null;
    if (department === '' || department === null) {
      // 設為通用模版 - 只有 ADMIN/HR 可以
      if (!isAdmin) {
        return NextResponse.json({ error: '只有管理員可建立通用模版' }, { status: 403 });
      }
      templateDepartment = null;
    } else if (department) {
      // 指定部門 - 檢查權限
      if (!isAdmin && !managedDepartments.includes(department)) {
        return NextResponse.json({ error: '無權限建立該部門的模版' }, { status: 403 });
      }
      templateDepartment = department;
    } else {
      // 未指定部門 - 使用建立者的部門
      templateDepartment = employee?.department || null;
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

    // 獲取現有模版列表
    const templates = loadTemplates();
    
    // 生成新的 ID
    const newId = templates.length > 0 ? Math.max(...templates.map(t => t.id)) + 1 : 1;

    // 建立新模版
    const newTemplate: WeeklyTemplate = {
      id: newId,
      name,
      description: description || '',
      department: templateDepartment,
      createdById: user.employeeId,
      createdByName: employee?.name || '未知',
      monday: monday as DaySchedule,
      tuesday: tuesday as DaySchedule,
      wednesday: wednesday as DaySchedule,
      thursday: thursday as DaySchedule,
      friday: friday as DaySchedule,
      saturday: saturday as DaySchedule,
      sunday: sunday as DaySchedule,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 將新模版加入到列表中並儲存
    templates.push(newTemplate);
    saveTemplates(templates);

    return NextResponse.json({ 
      success: true,
      message: '週模版建立成功',
      template: newTemplate 
    });
  } catch (error) {
    console.error('建立週模版失敗:', error);
    return NextResponse.json({ error: '建立週模版失敗' }, { status: 500 });
  }
}
