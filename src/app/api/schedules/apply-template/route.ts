import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
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

// 計算用戶可管理的據點列表
async function getManageableLocations(user: { role: string; employeeId?: number }): Promise<string[]> {
  if (user.role === 'ADMIN' || user.role === 'HR') {
    return []; // 空陣列代表不限
  }
  
  if (!user.employeeId) return [];
  
  const locations: string[] = [];
  
  const managerRecord = await prisma.departmentManager.findFirst({
    where: { employeeId: user.employeeId, isActive: true }
  });
  if (managerRecord) {
    locations.push(managerRecord.department);
  }
  
  const permRecord = await prisma.attendancePermission.findUnique({
    where: { employeeId: user.employeeId }
  });
  if (permRecord?.permissions) {
    const permissions = permRecord.permissions as { scheduleManagement?: string[] };
    if (Array.isArray(permissions.scheduleManagement)) {
      locations.push(...permissions.scheduleManagement);
    }
  }
  
  return [...new Set(locations)];
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 開始處理套用模版請求');
    
    // 權限檢查
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '請先登入' }, { status: 401 });
    }

    const body = await request.json();
    const { templateId, year, month, employeeIds } = body;
    console.log('📥 接收到參數:', { templateId, year, month, employeeIds });

    if (!templateId || !year || !month || !employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      console.log('❌ 缺少必要參數');
      return NextResponse.json(
        { error: '缺少必要參數或未選擇員工' },
        { status: 400 }
      );
    }

    // 檢查權限
    const isFullAdmin = user.role === 'ADMIN' || user.role === 'HR';
    const manageableLocations = await getManageableLocations(user);
    
    if (!isFullAdmin && manageableLocations.length === 0) {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    // 載入模版
    console.log('📂 載入模版...');
    const templates = loadTemplates();
    console.log(`📋 找到模版數量: ${templates.length}`);
    
    const template = templates.find((t: Template) => Number(t.id) === Number(templateId));
    
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
        id: { in: employeeIds },
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

    // 權限檢查：確保只能管理可管理部門的員工
    if (!isFullAdmin && manageableLocations.length > 0) {
      const invalidEmployees = employees.filter(emp => !emp.department || !manageableLocations.includes(emp.department));
      if (invalidEmployees.length > 0) {
        return NextResponse.json({
          error: `無權限管理以下員工的班表: ${invalidEmployees.map(e => e.name).join(', ')}`
        }, { status: 403 });
      }
    }

    // 獲取該月份的所有日期
    console.log('📅 生成月份日期...');
    const monthDates = getMonthDates(year, month);
    console.log(`📆 月份日期數量: ${monthDates.length}`);

    // 刪除該月份選定員工的現有排程
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`;
    
    const deleteResult = await prisma.schedule.deleteMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: {
          gte: monthStart,
          lte: monthEnd
        }
      }
    });
    console.log(`🧹 刪除現有排程數量: ${deleteResult.count}`);

    // 生成新的排程
    const newSchedules = [];

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
            endTime: hasTime ? (daySchedule.endTime || '') : ''
          });
        }
      }
    }

    console.log(`✨ 準備新增排程數量: ${newSchedules.length}`);

    // 批量新增排程到資料庫
    if (newSchedules.length > 0) {
      await prisma.schedule.createMany({
        data: newSchedules
      });
    }
    console.log('✅ 排程儲存完成');

    return NextResponse.json({
      message: `成功套用模版 "${template.name}" 到 ${year}年${month}月，共 ${employees.length} 位員工`,
      applied: newSchedules.length,
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