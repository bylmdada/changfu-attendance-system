import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

interface ScheduleData {
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

interface JWTPayload {
  userId: number;
  role: string;
}

async function getCurrentUser(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;
    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as JWTPayload;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        employee: true
      }
    });

    return user;
  } catch {
    return null;
  }
}

// 從JSON文件讀取班表數據
function readSchedulesFromJSON(): ScheduleData[] {
  try {
    const dataPath = path.join(process.cwd(), 'data', 'schedules.json');
    const data = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('讀取班表數據失敗:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員和HR可以查詢所有員工班表
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('yearMonth');
    const employeeId = searchParams.get('employeeId');
    const employeeName = searchParams.get('employeeName');

    // 從JSON文件讀取數據
    const allSchedules = readSchedulesFromJSON();
    let filteredSchedules = allSchedules;

    // 按年月份篩選
    if (yearMonth) {
      const [year, month] = yearMonth.split('-');
      filteredSchedules = filteredSchedules.filter((schedule: ScheduleData) => {
        const scheduleDate = new Date(schedule.workDate);
        return scheduleDate.getFullYear().toString() === year && 
               (scheduleDate.getMonth() + 1).toString().padStart(2, '0') === month;
      });
    }

    // 按員編篩選
    if (employeeId) {
      console.log('搜尋員編:', employeeId);
      filteredSchedules = filteredSchedules.filter((schedule: ScheduleData) => {
        const emp = schedule.employee;
        if (!emp?.employeeId) return false;
        
        const empId = emp.employeeId.toLowerCase();
        const searchId = employeeId.toLowerCase();
        
        // 直接比對
        if (empId.includes(searchId)) return true;
        
        // 如果搜尋的是純數字（如0001），轉換為EMP格式
        if (/^\d+$/.test(searchId)) {
          const empWithPrefix = `emp${searchId.padStart(3, '0')}`;
          console.log(`檢查數字轉EMP: ${searchId} -> ${empWithPrefix}, 比對 ${empId}`);
          if (empId === empWithPrefix) return true;
        }
        
        // 如果搜尋的是EMP開頭，也檢查純數字格式
        if (searchId.startsWith('emp')) {
          const numericPart = searchId.replace('emp', '');
          console.log(`檢查EMP轉數字: ${searchId} -> ${numericPart}, 比對 ${empId}`);
          if (empId.includes(numericPart)) return true;
        }
        
        console.log(`員編比對失敗: 搜尋"${searchId}" vs 員工"${empId}"`);
        return false;
      });
      console.log('員編篩選後結果數量:', filteredSchedules.length);
    }

    // 按姓名篩選
    if (employeeName) {
      filteredSchedules = filteredSchedules.filter((schedule: ScheduleData) => 
        schedule.employee?.name?.includes(employeeName)
      );
    }

    // 按日期排序
    filteredSchedules.sort((a: ScheduleData, b: ScheduleData) => 
      new Date(a.workDate).getTime() - new Date(b.workDate).getTime()
    );

    return NextResponse.json({
      success: true,
      schedules: filteredSchedules
    });

  } catch (error) {
    console.error('搜尋班表失敗:', error);
    return NextResponse.json(
      { error: '搜尋班表失敗' },
      { status: 500 }
    );
  }
}
