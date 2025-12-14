import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface Schedule {
  id: number;
  employeeId: number;
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime: number;
  createdAt: string;
  updatedAt: string;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

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

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'weekly-templates.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');

// 確保資料目錄存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 載入模版
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

// 載入排程
function loadSchedules(): Schedule[] {
  ensureDataDir();
  try {
    if (fs.existsSync(SCHEDULES_FILE)) {
      const data = fs.readFileSync(SCHEDULES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('載入排程失敗:', error);
  }
  return [];
}

// 儲存排程
function saveSchedules(schedules: Schedule[]) {
  ensureDataDir();
  try {
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
  } catch (error) {
    console.error('儲存排程失敗:', error);
    throw error;
  }
}

// 獲取月份的所有日期
function getMonthDates(year: number, month: number) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    dates.push({
      date: date.toISOString().split('T')[0],
      dayOfWeek: date.getDay() // 0=Sunday, 1=Monday, ..., 6=Saturday
    });
  }
  
  return dates;
}

// 獲取員工列表
async function getEmployees(): Promise<Employee[]> {
  // 直接使用模擬資料，避免內部 HTTP 請求的複雜性
  console.log('使用模擬員工資料');
  return [
    {
      id: 1,
      employeeId: 'EMP001',
      name: '張三',
      department: '技術部',
      position: '工程師'
    },
    {
      id: 2,
      employeeId: 'EMP002', 
      name: '李四',
      department: '業務部',
      position: '業務員'
    },
    {
      id: 3,
      employeeId: 'EMP003',
      name: '王五',
      department: '人事部',
      position: '人事專員'
    }
  ];
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 開始處理套用模版請求');
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

    // 載入模版
    console.log('📂 載入模版...');
    const templates = loadTemplates();
    console.log(`📋 找到模版數量: ${templates.length}`);
    
    // 確保 templateId 是數字類型進行比較
    const template = templates.find((t: Template) => Number(t.id) === Number(templateId));
    
    if (!template) {
      console.log(`❌ 找不到指定的模版, templateId: ${templateId}`);
      console.log('🔍 可用模版:', templates.map(t => `${t.id}: ${t.name}`).join(', '));
      return NextResponse.json(
        { error: '找不到指定的模版' },
        { status: 404 }
      );
    }
    console.log(`✅ 找到模版: ${template.name}`);

    // 載入現有排程
    console.log('📂 載入現有排程...');
    const schedules = loadSchedules();
    console.log(`📊 現有排程數量: ${schedules.length}`);
    
    // 獲取員工列表
    console.log('👥 獲取員工列表...');
    const employees = await getEmployees();
    console.log(`👤 員工數量: ${employees.length}`);
    
    // 獲取該月份的所有日期
    console.log('📅 生成月份日期...');
    const monthDates = getMonthDates(year, month);
    console.log(`📆 月份日期數量: ${monthDates.length}`);
    
    // 移除該月份現有的排程（僅針對選定的員工）
    const filteredSchedules = schedules.filter((schedule: Schedule) => {
      const scheduleDate = new Date(schedule.workDate);
      const isTargetMonth = scheduleDate.getFullYear() === year && scheduleDate.getMonth() === month - 1;
      const isSelectedEmployee = employeeIds.includes(schedule.employeeId);
      
      // 保留非目標月份的排程，或不是選定員工的排程
      return !(isTargetMonth && isSelectedEmployee);
    });
    console.log(`🧹 移除現有排程後剩餘: ${filteredSchedules.length}`);

    // 獲取選定的員工
    const selectedEmployees = employees.filter(emp => employeeIds.includes(emp.id));
    console.log(`👥 選定員工數量: ${selectedEmployees.length}`);

    // 生成新的排程
    const newSchedules: Schedule[] = [];
    let scheduleId = Math.max(0, ...schedules.map((s: Schedule) => s.id || 0)) + 1;

    for (const employee of selectedEmployees) {
      for (const dateInfo of monthDates) {
        // 根據星期幾獲取對應的模版排程
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dateInfo.dayOfWeek] as keyof Template;
        const daySchedule = template[dayName] as { shiftType: string; startTime: string; endTime: string; breakTime: number };

        if (daySchedule && daySchedule.shiftType && 
            daySchedule.shiftType !== 'OFF' && 
            daySchedule.shiftType !== 'RD' && 
            daySchedule.shiftType !== 'rd') {
          newSchedules.push({
            id: scheduleId++,
            employeeId: employee.id,
            workDate: dateInfo.date,
            shiftType: daySchedule.shiftType,
            startTime: daySchedule.startTime,
            endTime: daySchedule.endTime,
            breakTime: daySchedule.breakTime || 60,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            employee: {
              id: employee.id,
              employeeId: employee.employeeId,
              name: employee.name,
              department: employee.department,
              position: employee.position
            }
          });
        }
      }
    }

    console.log(`✨ 生成新排程數量: ${newSchedules.length}`);

    // 合併並儲存排程
    const allSchedules = [...filteredSchedules, ...newSchedules];
    console.log(`💾 準備儲存排程，總數量: ${allSchedules.length}`);
    saveSchedules(allSchedules);
    console.log('✅ 排程儲存完成');

    return NextResponse.json({
      message: `成功套用模版 "${template.name}" 到 ${year}年${month}月，共 ${selectedEmployees.length} 位員工`,
      applied: newSchedules.length,
      employees: selectedEmployees.length,
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