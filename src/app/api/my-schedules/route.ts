import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('[debug] 個人班表API被調用');
    
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    
    // 獲取當前用戶
    const user = await getUserFromRequest(request);
    if (!user) {
      console.log('[debug] 用戶未授權');
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    console.log('[debug] 個人班表查詢 - 用戶:', JSON.stringify(user));
    console.log('[debug] 查詢參數:', { startDate, endDate, year, month });

    // 構建查詢條件
    const where: {
      employeeId: number;
      workDate?: {
        gte?: string;
        lte?: string;
      };
    } = {
      employeeId: user.employeeId
    };

    // 根據參數過濾日期
    if (year && month) {
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      const startOfMonth = `${yearNum}-${monthNum.toString().padStart(2, '0')}-01`;
      const endOfMonth = `${yearNum}-${monthNum.toString().padStart(2, '0')}-31`;
      where.workDate = {
        gte: startOfMonth,
        lte: endOfMonth
      };
    } else if (startDate && endDate) {
      where.workDate = {
        gte: startDate,
        lte: endDate
      };
    }

    // 查詢班表
    console.log('[debug] 即將執行 Prisma 查詢，條件:', JSON.stringify(where));
    
    const schedules = await prisma.schedule.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      },
      orderBy: {
        workDate: 'asc'
      }
    });

    console.log(`[debug] Prisma 查詢結果: 找到 ${schedules.length} 筆班表記錄`);
    
    if (schedules.length > 0) {
      console.log('[debug] 前3筆班表記錄:', schedules.slice(0, 3).map(s => ({
        id: s.id,
        employeeId: s.employeeId,
        workDate: s.workDate,
        shiftType: s.shiftType
      })));
    }
    
    // 如果沒有找到記錄，嘗試直接查詢數據庫
    if (schedules.length === 0) {
      console.log('[debug] 沒有找到記錄，檢查數據庫連接和表結構...');
      
      // 測試查詢員工表
      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId }
      });
      console.log('[debug] 員工記錄查詢結果:', employee ? '找到員工' : '未找到員工');
      
      // 測試查詢所有班表記錄（不限員工）
      const allSchedules = await prisma.schedule.findMany({
        take: 5
      });
      console.log('[debug] 所有班表記錄（前5筆）:', allSchedules.length);
    }

    console.log(`[debug] 找到 ${schedules.length} 筆班表記錄`);

    // 轉換為前端期望的格式
    const formattedSchedules = schedules.map(schedule => ({
      id: schedule.id,
      employeeId: schedule.employeeId,
      workDate: schedule.workDate,
      shiftType: schedule.shiftType,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      employee: schedule.employee
    }));

    return NextResponse.json({
      success: true,
      schedules: formattedSchedules,
      total: formattedSchedules.length
    });
  } catch (error) {
    console.error('個人班表查詢錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
