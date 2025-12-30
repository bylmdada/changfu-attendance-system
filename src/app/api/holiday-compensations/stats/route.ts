/**
 * 國定假日補休統計 API
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const employeeId = searchParams.get('employeeId'); // 可選，指定員工
    const department = searchParams.get('department'); // 可選，篩選部門

    // 取得用戶角色
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true, employeeId: true }
    });

    if (!user) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    const isAdmin = user.role === 'ADMIN' || user.role === 'HR';

    // 取得該年度國定假日數量
    const holidaysCount = await prisma.holiday.count({
      where: { year, isActive: true }
    });

    // 取得國定假日列表
    const holidays = await prisma.holiday.findMany({
      where: { year, isActive: true },
      orderBy: { date: 'asc' },
      select: { id: true, name: true, date: true }
    });

    // 個人統計
    if (!isAdmin || employeeId) {
      const targetEmployeeId = employeeId ? parseInt(employeeId) : user.employeeId;
      
      if (!targetEmployeeId) {
        return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
      }

      // 取得員工資訊
      const employee = await prisma.employee.findUnique({
        where: { id: targetEmployeeId },
        select: { id: true, name: true, employeeId: true, department: true }
      });

      // 取得該員工的補休記錄
      const compensations = await prisma.holidayCompensation.findMany({
        where: { employeeId: targetEmployeeId, year },
        orderBy: { holidayDate: 'asc' }
      });

      // 計算統計
      const taken = compensations.filter(c => c.status === 'TAKEN').length;
      const notRequired = compensations.filter(c => c.status === 'NOT_REQUIRED').length;
      const pending = holidaysCount - taken - notRequired;

      return NextResponse.json({
        success: true,
        type: 'individual',
        year,
        employee,
        holidays,
        compensations,
        stats: {
          total: holidaysCount,
          taken,          // 已補休
          notRequired,    // 當天休假無需補休
          pending,        // 待補休
          progress: holidaysCount > 0 ? Math.round(((taken + notRequired) / holidaysCount) * 100) : 0
        }
      });
    }

    // 全員統計（管理員視角）
    const whereClause: { isActive?: boolean; department?: string } = { isActive: true };
    if (department) {
      whereClause.department = department;
    }

    const employees = await prisma.employee.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        employeeId: true,
        department: true,
        holidayCompensations: {
          where: { year },
          select: {
            id: true,
            holidayName: true,
            holidayDate: true,
            status: true,
            compensationDate: true
          }
        }
      },
      orderBy: [{ department: 'asc' }, { name: 'asc' }]
    });

    // 計算每位員工的統計
    const employeeStats = employees.map(emp => {
      const taken = emp.holidayCompensations.filter(c => c.status === 'TAKEN').length;
      const notRequired = emp.holidayCompensations.filter(c => c.status === 'NOT_REQUIRED').length;
      const pending = holidaysCount - taken - notRequired;
      
      return {
        id: emp.id,
        employeeId: emp.employeeId,
        name: emp.name,
        department: emp.department,
        stats: {
          total: holidaysCount,
          taken,
          notRequired,
          pending,
          progress: holidaysCount > 0 ? Math.round(((taken + notRequired) / holidaysCount) * 100) : 0
        },
        compensations: emp.holidayCompensations
      };
    });

    // 總體統計
    const totalTaken = employeeStats.reduce((sum, e) => sum + e.stats.taken, 0);
    const totalNotRequired = employeeStats.reduce((sum, e) => sum + e.stats.notRequired, 0);
    const totalPending = employeeStats.reduce((sum, e) => sum + e.stats.pending, 0);

    // 取得部門列表供篩選
    const departments = await prisma.employee.findMany({
      where: { isActive: true },
      select: { department: true },
      distinct: ['department']
    });

    return NextResponse.json({
      success: true,
      type: 'summary',
      year,
      holidays,
      employees: employeeStats,
      overallStats: {
        employeeCount: employees.length,
        holidaysCount,
        totalTaken,
        totalNotRequired,
        totalPending
      },
      departments: departments.map(d => d.department).filter(Boolean)
    });
  } catch (error) {
    console.error('取得國定假日補休統計失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
