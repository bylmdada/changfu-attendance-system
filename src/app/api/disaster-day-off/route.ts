import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// 天災類型標籤
const DISASTER_TYPES = {
  TYPHOON: '颱風',
  EARTHQUAKE: '地震',
  RAIN: '雨災',
  WIND: '風災',
  OTHER: '其他'
};

// 停班類型標籤
const STOP_WORK_TYPES = {
  FULL: '全日停班',
  AM: '上午停班',
  PM: '下午停班'
};

// GET - 取得天災假記錄列表
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員和HR可以查看
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    // 建立查詢條件
    const where: Record<string, unknown> = {};
    
    if (year && month) {
      const startDate = `${year}-${month.padStart(2, '0')}-01`;
      const endDate = `${year}-${month.padStart(2, '0')}-31`;
      where.disasterDate = {
        gte: startDate,
        lte: endDate
      };
    } else if (year) {
      where.disasterDate = {
        gte: `${year}-01-01`,
        lte: `${year}-12-31`
      };
    }

    const records = await prisma.disasterDayOff.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            department: true
          }
        }
      },
      orderBy: { disasterDate: 'desc' }
    });

    return NextResponse.json({
      records,
      labels: {
        disasterTypes: DISASTER_TYPES,
        stopWorkTypes: STOP_WORK_TYPES
      }
    });

  } catch (error) {
    console.error('取得天災假記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 批量設定天災假
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/disaster-day-off');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員和HR可以設定
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const data = await request.json();
    const { 
      disasterDate, 
      numberOfDays = 1,
      disasterType, 
      stopWorkType, 
      affectedScope = 'ALL',
      affectedDepartments = [],  // 複選部門
      affectedEmployeeIds = [],  // 複選員工
      description 
    } = data;

    // 驗證必填欄位
    if (!disasterDate || !disasterType || !stopWorkType) {
      return NextResponse.json({ error: '請填寫完整資訊' }, { status: 400 });
    }

    // 驗證日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(disasterDate)) {
      return NextResponse.json({ error: '日期格式不正確' }, { status: 400 });
    }

    // 驗證天數
    const days = Math.min(Math.max(1, parseInt(numberOfDays) || 1), 7);

    // 驗證天災類型
    if (!['TYPHOON', 'EARTHQUAKE', 'RAIN', 'WIND', 'OTHER'].includes(disasterType)) {
      return NextResponse.json({ error: '無效的天災類型' }, { status: 400 });
    }

    // 驗證停班類型
    if (!['FULL', 'AM', 'PM'].includes(stopWorkType)) {
      return NextResponse.json({ error: '無效的停班類型' }, { status: 400 });
    }

    // 產生日期範圍
    const dates: string[] = [];
    const startDate = new Date(disasterDate);
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }

    // 檢查是否已存在
    const existingDates: string[] = [];
    for (const date of dates) {
      const existing = await prisma.disasterDayOff.findFirst({
        where: {
          disasterDate: date,
          affectedScope
        }
      });
      if (existing) {
        existingDates.push(date);
      }
    }

    if (existingDates.length > 0) {
      return NextResponse.json({ 
        error: `以下日期已設定天災假：${existingDates.join(', ')}` 
      }, { status: 400 });
    }

    // 取得受影響的員工
    let affectedEmployees: { id: number }[] = [];
    
    if (affectedScope === 'ALL') {
      affectedEmployees = await prisma.employee.findMany({
        where: { isActive: true },
        select: { id: true }
      });
    } else if (affectedScope === 'DEPARTMENTS' && affectedDepartments.length > 0) {
      affectedEmployees = await prisma.employee.findMany({
        where: { 
          isActive: true,
          department: { in: affectedDepartments }
        },
        select: { id: true }
      });
    } else if (affectedScope === 'EMPLOYEES' && affectedEmployeeIds.length > 0) {
      affectedEmployees = await prisma.employee.findMany({
        where: { 
          isActive: true,
          id: { in: affectedEmployeeIds.map((id: number | string) => typeof id === 'string' ? parseInt(id) : id) }
        },
        select: { id: true }
      });
    }

    if (affectedEmployees.length === 0) {
      return NextResponse.json({ error: '未選擇任何受影響的員工' }, { status: 400 });
    }

    // 建立多天的天災假記錄
    const createdRecords = [];
    let totalUpdated = 0;
    let totalCreated = 0;

    for (const date of dates) {
      // 先收集原始班表資訊
      const originalSchedulesData: { employeeId: number; shiftType: string; startTime: string; endTime: string }[] = [];
      
      for (const emp of affectedEmployees) {
        const existingSchedule = await prisma.schedule.findUnique({
          where: {
            employeeId_workDate: {
              employeeId: emp.id,
              workDate: date
            }
          }
        });
        
        if (existingSchedule) {
          originalSchedulesData.push({
            employeeId: emp.id,
            shiftType: existingSchedule.shiftType,
            startTime: existingSchedule.startTime,
            endTime: existingSchedule.endTime
          });
        }
      }

      const record = await prisma.disasterDayOff.create({
        data: {
          disasterDate: date,
          disasterType,
          stopWorkType,
          affectedScope,
          affectedDepartments: affectedScope === 'DEPARTMENTS' ? JSON.stringify(affectedDepartments) : null,
          affectedEmployeeIds: affectedScope === 'EMPLOYEES' ? JSON.stringify(affectedEmployeeIds) : null,
          description: description ? `${description}${days > 1 ? ` (${date})` : ''}` : undefined,
          affectedCount: affectedEmployees.length,
          originalSchedules: JSON.stringify(originalSchedulesData),
          createdBy: user.employeeId
        },
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              department: true
            }
          }
        }
      });
      createdRecords.push(record);

      // 批量更新員工班表為 TD
      for (const emp of affectedEmployees) {
        const existingSchedule = await prisma.schedule.findUnique({
          where: {
            employeeId_workDate: {
              employeeId: emp.id,
              workDate: date
            }
          }
        });

        if (existingSchedule) {
          await prisma.schedule.update({
            where: { id: existingSchedule.id },
            data: { 
              shiftType: 'TD',
              startTime: stopWorkType === 'FULL' ? '00:00' : (stopWorkType === 'AM' ? '00:00' : '12:00'),
              endTime: stopWorkType === 'FULL' ? '23:59' : (stopWorkType === 'AM' ? '12:00' : '23:59')
            }
          });
          totalUpdated++;
        } else {
          await prisma.schedule.create({
            data: {
              employeeId: emp.id,
              workDate: date,
              shiftType: 'TD',
              startTime: stopWorkType === 'FULL' ? '00:00' : (stopWorkType === 'AM' ? '00:00' : '12:00'),
              endTime: stopWorkType === 'FULL' ? '23:59' : (stopWorkType === 'AM' ? '12:00' : '23:59')
            }
          });
          totalCreated++;
        }
      }
    }

    const dateRange = days > 1 
      ? `${dates[0]} 至 ${dates[dates.length - 1]}（共 ${days} 天）` 
      : disasterDate;

    return NextResponse.json({
      success: true,
      records: createdRecords,
      message: `已設定 ${dateRange} 天災假。影響 ${affectedEmployees.length} 位員工 × ${days} 天（更新: ${totalUpdated}, 新增: ${totalCreated}）`
    });

  } catch (error) {
    console.error('設定天災假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT - 編輯天災假記錄
export async function PUT(request: NextRequest) {
  try {
    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員和HR可以編輯
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const data = await request.json();
    const { id, disasterType, stopWorkType, description } = data;

    if (!id) {
      return NextResponse.json({ error: '缺少記錄ID' }, { status: 400 });
    }

    const record = await prisma.disasterDayOff.findUnique({
      where: { id: parseInt(id) }
    });

    if (!record) {
      return NextResponse.json({ error: '找不到記錄' }, { status: 404 });
    }

    // 更新記錄
    const updatedRecord = await prisma.disasterDayOff.update({
      where: { id: parseInt(id) },
      data: {
        disasterType: disasterType || record.disasterType,
        stopWorkType: stopWorkType || record.stopWorkType,
        description: description !== undefined ? description : record.description
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            department: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      record: updatedRecord,
      message: `已更新 ${record.disasterDate} 的天災假記錄`
    });

  } catch (error) {
    console.error('編輯天災假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE - 刪除天災假記錄
export async function DELETE(request: NextRequest) {
  try {
    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員可以刪除
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少記錄ID' }, { status: 400 });
    }

    const record = await prisma.disasterDayOff.findUnique({
      where: { id: parseInt(id) }
    });

    if (!record) {
      return NextResponse.json({ error: '找不到記錄' }, { status: 404 });
    }

    // 恢復原始班表
    let restoredCount = 0;
    if (record.originalSchedules) {
      try {
        const originalSchedules = JSON.parse(record.originalSchedules) as {
          employeeId: number;
          shiftType: string;
          startTime: string;
          endTime: string;
        }[];
        
        for (const orig of originalSchedules) {
          const schedule = await prisma.schedule.findUnique({
            where: {
              employeeId_workDate: {
                employeeId: orig.employeeId,
                workDate: record.disasterDate
              }
            }
          });
          
          if (schedule && schedule.shiftType === 'TD') {
            await prisma.schedule.update({
              where: { id: schedule.id },
              data: {
                shiftType: orig.shiftType,
                startTime: orig.startTime,
                endTime: orig.endTime
              }
            });
            restoredCount++;
          }
        }
      } catch (e) {
        console.error('解析原始班表失敗:', e);
      }
    }

    // 刪除記錄
    await prisma.disasterDayOff.delete({
      where: { id: parseInt(id) }
    });

    return NextResponse.json({
      success: true,
      message: `已刪除 ${record.disasterDate} 的天災假記錄。${restoredCount > 0 ? `已恢復 ${restoredCount} 位員工的原始班表。` : ''}`
    });

  } catch (error) {
    console.error('刪除天災假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
