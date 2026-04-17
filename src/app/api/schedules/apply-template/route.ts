import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import fs from 'fs';
import path from 'path';

interface Template {
  id: number;
  name: string;
  description: string;
  monday: { shiftType: string; startTime: string; endTime: string; breakTime: number };
  tuesday: { shiftType: string; startTime: string; endTime: string; breakTime: number };
  wednesday: { shiftType: string; startTime: string; endTime: string; breakTime: number };
  thursday: { shiftType: string; startTime: string; endTime: string; breakTime: number };
  friday: { shiftType: string; startTime: string; endTime: string; breakTime: number };
  saturday: { shiftType: string; startTime: string; endTime: string; breakTime: number };
  sunday: { shiftType: string; startTime: string; endTime: string; breakTime: number };
  createdAt: string;
  updatedAt?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'weekly-templates.json');

// 確保資料目錄存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 載入模版（從 JSON 檔案）
function loadTemplates(): Template[] {
  ensureDataDir();
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      const data = fs.readFileSync(TEMPLATES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('載入模版失敗:', error);
  }
  return [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 獲取月份的所有日期
function getMonthDates(year: number, month: number) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    // 使用本地日期格式，避免 toISOString() 的 UTC 轉換問題
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    dates.push({
      date: dateStr,
      dayOfWeek: date.getDay() // 0=Sunday, 1=Monday, ..., 6=Saturday
    });
  }
  
  return dates;
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 開始處理套用模版請求');
    
    // 權限檢查
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '請先登入' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '缺少必要參數或未選擇員工' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json(
        { error: '缺少必要參數或未選擇員工' },
        { status: 400 }
      );
    }

    const { templateId, year, month, employeeIds, overwriteExisting } = body;
    console.log('📥 接收到參數:', { templateId, year, month, employeeIds, overwriteExisting });

    if (!templateId || !year || !month || !employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      console.log('❌ 缺少必要參數');
      return NextResponse.json(
        { error: '缺少必要參數或未選擇員工' },
        { status: 400 }
      );
    }

    const templateIdResult = parseIntegerQueryParam(String(templateId), { min: 1, max: 99999999 });
    const yearResult = parseIntegerQueryParam(String(year), { min: 1, max: 99999999 });
    const monthResult = parseIntegerQueryParam(String(month), { min: 1, max: 12 });
    if (!templateIdResult.isValid || templateIdResult.value === null) {
      return NextResponse.json(
        { error: 'templateId 格式錯誤' },
        { status: 400 }
      );
    }

    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json(
        { error: 'year 格式錯誤' },
        { status: 400 }
      );
    }

    if (!monthResult.isValid || monthResult.value === null) {
      return NextResponse.json(
        { error: 'month 格式錯誤' },
        { status: 400 }
      );
    }

    const normalizedEmployeeIds = employeeIds.map((employeeId: number | string) => {
      const result = parseIntegerQueryParam(String(employeeId), { min: 1, max: 99999999 });
      return result.isValid ? result.value : null;
    }).filter((employeeId: number | null): employeeId is number => employeeId !== null);

    if (normalizedEmployeeIds.length !== employeeIds.length) {
      return NextResponse.json(
        { error: 'employeeIds 格式錯誤' },
        { status: 400 }
      );
    }

    if (overwriteExisting !== true) {
      return NextResponse.json(
        { error: '套用模版前必須明確確認覆蓋既有班表' },
        { status: 400 }
      );
    }

    const yearValue = yearResult.value;
    const monthValue = monthResult.value;

    // 檢查權限
    const isFullAdmin = user.role === 'ADMIN' || user.role === 'HR';
    const manageableDepartments = await getManageableDepartments(user);
    
    if (!isFullAdmin && manageableDepartments.length === 0) {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    // 載入模版
    console.log('📂 載入模版...');
    const templates = loadTemplates();
    console.log(`📋 找到模版數量: ${templates.length}`);
    
    const template = templates.find((t: Template) => t.id === templateIdResult.value);
    
    if (!template) {
      console.log(`❌ 找不到指定的模版, templateId: ${templateId}`);
      return NextResponse.json(
        { error: '找不到指定的模版' },
        { status: 404 }
      );
    }
    console.log(`✅ 找到模版: ${template.name}`);

    // 從資料庫獲取員工
    console.log('👥 從資料庫獲取員工...');
    const employees = await prisma.employee.findMany({
      where: {
        id: { in: normalizedEmployeeIds },
        isActive: true
      },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        position: true
      }
    });
    console.log(`👤 找到員工數量: ${employees.length}`);

    if (employees.length !== normalizedEmployeeIds.length) {
      const foundEmployeeIds = new Set(employees.map(employee => employee.id));
      const missingEmployeeIds = normalizedEmployeeIds.filter(employeeId => !foundEmployeeIds.has(employeeId));
      return NextResponse.json({
        error: '部分員工不存在或已停用，請重新整理後再試',
        failedEmployeeIds: missingEmployeeIds,
      }, { status: 400 });
    }

    // 權限檢查：確保只能管理可管理部門的員工
    if (!isFullAdmin && manageableDepartments.length > 0) {
      const invalidEmployees = employees.filter(emp => !emp.department || !manageableDepartments.includes(emp.department));
      if (invalidEmployees.length > 0) {
        return NextResponse.json({
          error: `無權限管理以下員工的班表: ${invalidEmployees.map(e => e.name).join(', ')}`
        }, { status: 403 });
      }
    }

    // 獲取該月份的所有日期
    console.log('📅 生成月份日期...');
    const monthDates = getMonthDates(yearValue, monthValue);
    console.log(`📆 月份日期數量: ${monthDates.length}`);

    // 刪除該月份選定員工的現有排程
    const monthStart = `${yearValue}-${String(monthValue).padStart(2, '0')}-01`;
    const monthEnd = `${yearValue}-${String(monthValue).padStart(2, '0')}-31`;
    
    const scheduleDeleteWhere = {
      employeeId: { in: normalizedEmployeeIds },
      workDate: {
        gte: monthStart,
        lte: monthEnd
      }
    };

    let deleteResult: { count: number } = { count: 0 };

    // 生成新的排程
    const newSchedules: Array<{
      employeeId: number;
      workDate: string;
      shiftType: string;
      startTime: string;
      endTime: string;
      breakTime: number;
    }> = [];

    for (const employee of employees) {
      for (const dateInfo of monthDates) {
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dateInfo.dayOfWeek] as keyof Template;
        const daySchedule = template[dayName] as { shiftType: string; startTime: string; endTime: string; breakTime: number };

        // 只排除 OFF，RD/rd 等也要建立記錄以便在月曆上顯示
        if (daySchedule && daySchedule.shiftType && daySchedule.shiftType !== 'OFF') {
          // 非工作班別（NH/RD/rd/FDL/TD）不應有時間
          const noTimeShiftTypes = ['NH', 'RD', 'rd', 'FDL', 'TD'];
          const hasTime = !noTimeShiftTypes.includes(daySchedule.shiftType);
          
          newSchedules.push({
            employeeId: employee.id,
            workDate: dateInfo.date,
            shiftType: daySchedule.shiftType,
            startTime: hasTime ? (daySchedule.startTime || '') : '',
            endTime: hasTime ? (daySchedule.endTime || '') : '',
            breakTime: hasTime ? (daySchedule.breakTime || 0) : 0
          });
        }
      }
    }

    console.log(`✨ 準備新增排程數量: ${newSchedules.length}`);

    // 批量新增排程到資料庫
    const createResult = await prisma.$transaction(async (tx) => {
      deleteResult = await tx.schedule.deleteMany({
        where: scheduleDeleteWhere
      });

      if (newSchedules.length === 0) {
        return { count: 0 };
      }

      return tx.schedule.createMany({
        data: newSchedules
      });
    });
    console.log(`🧹 刪除現有排程數量: ${deleteResult.count}`);

    if (newSchedules.length > 0 && createResult.count === 0) {
      return NextResponse.json({ error: '套用模版失敗，未建立任何班表' }, { status: 400 });
    }
    console.log('✅ 排程儲存完成');

    return NextResponse.json({
      message: `成功套用模版 "${template.name}" 到 ${yearValue}年${monthValue}月，共建立 ${createResult.count} 筆班表`,
      applied: createResult.count,
      employees: employees.length,
      success: true
    });

  } catch (error) {
    console.error('💥 套用模版失敗:', error);
    console.error('📍 錯誤堆疊:', error instanceof Error ? error.stack : '未知錯誤');
    return NextResponse.json(
      { error: '套用模版失敗，請稍後再試', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}