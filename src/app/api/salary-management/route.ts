/**
 * 薪資管理 API
 * GET: 取得薪資歷史 / 員工列表
 * POST: 新增調薪記錄
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { 
  adjustSalary, 
  getSalaryHistory, 
  calculateHourlyRate,
  initializeSalaryHistory,
  AdjustmentType 
} from '@/lib/salary-utils';

// GET: 取得薪資資訊
export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員可以查看
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'list'; // list | history | summary
    const employeeId = searchParams.get('employeeId');

    // 取得單一員工薪資歷史
    if (type === 'history' && employeeId) {
      const history = await getSalaryHistory(parseInt(employeeId));
      const employee = await prisma.employee.findUnique({
        where: { id: parseInt(employeeId) },
        select: { 
          id: true, 
          employeeId: true, 
          name: true, 
          department: true,
          position: true,
          baseSalary: true,
          hourlyRate: true,
          hireDate: true
        }
      });

      return NextResponse.json({
        success: true,
        employee,
        history: history.map(h => ({
          id: h.id,
          effectiveDate: h.effectiveDate.toISOString().split('T')[0],
          baseSalary: h.baseSalary,
          hourlyRate: h.hourlyRate,
          previousSalary: h.previousSalary,
          adjustmentAmount: h.adjustmentAmount,
          adjustmentType: h.adjustmentType,
          reason: h.reason,
          notes: h.notes,
          approvedBy: h.approvedBy?.name || '系統',
          createdAt: h.createdAt.toISOString()
        }))
      });
    }

    // 取得員工列表（含薪資資訊）
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        position: true,
        baseSalary: true,
        hourlyRate: true,
        hireDate: true,
        salaryHistories: {
          orderBy: { effectiveDate: 'desc' },
          take: 1,
          select: {
            effectiveDate: true,
            adjustmentType: true,
            adjustmentAmount: true
          }
        }
      },
      orderBy: [{ department: 'asc' }, { name: 'asc' }]
    });

    // 統計資訊
    const stats = {
      totalEmployees: employees.length,
      avgSalary: employees.length > 0 
        ? Math.round(employees.reduce((sum, e) => sum + e.baseSalary, 0) / employees.length) 
        : 0,
      recentAdjustments: await prisma.salaryHistory.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          adjustmentType: { not: 'INITIAL' }
        }
      })
    };

    return NextResponse.json({
      success: true,
      employees: employees.map(e => ({
        id: e.id,
        employeeId: e.employeeId,
        name: e.name,
        department: e.department,
        position: e.position,
        baseSalary: e.baseSalary,
        hourlyRate: e.hourlyRate,
        hireDate: e.hireDate.toISOString().split('T')[0],
        lastAdjustment: e.salaryHistories[0] ? {
          date: e.salaryHistories[0].effectiveDate.toISOString().split('T')[0],
          type: e.salaryHistories[0].adjustmentType,
          amount: e.salaryHistories[0].adjustmentAmount
        } : null
      })),
      stats
    });

  } catch (error) {
    console.error('取得薪資資訊失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST: 新增調薪
export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const data = await request.json();
    const { 
      employeeId, 
      effectiveDate, 
      newBaseSalary, 
      adjustmentType, 
      reason, 
      notes,
      action 
    } = data;

    // 初始化薪資歷史
    if (action === 'initialize') {
      const result = await initializeSalaryHistory(employeeId, user.employeeId);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        message: '薪資歷史已初始化',
        salaryHistory: result.salaryHistory
      });
    }

    // 驗證必填欄位
    if (!employeeId || !effectiveDate || !newBaseSalary) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    // 驗證金額
    if (newBaseSalary < 0 || newBaseSalary > 1000000) {
      return NextResponse.json({ error: '薪資金額不合理' }, { status: 400 });
    }

    // 執行調薪
    const result = await adjustSalary({
      employeeId: parseInt(employeeId),
      effectiveDate: new Date(effectiveDate),
      newBaseSalary: parseFloat(newBaseSalary),
      adjustmentType: (adjustmentType as AdjustmentType) || 'RAISE',
      reason,
      notes,
      approvedById: user.employeeId
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // 取得員工名稱
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) },
      select: { name: true }
    });

    const adjustmentTypeNames: Record<string, string> = {
      INITIAL: '初始',
      RAISE: '調薪',
      PROMOTION: '晉升',
      ADJUSTMENT: '調整'
    };

    return NextResponse.json({
      success: true,
      message: `${employee?.name} 的薪資已${adjustmentTypeNames[adjustmentType] || '調整'}`,
      details: {
        previousSalary: result.previousSalary,
        newBaseSalary: result.newBaseSalary,
        adjustmentAmount: result.adjustmentAmount,
        newHourlyRate: result.newHourlyRate,
        effectiveDate
      }
    });

  } catch (error) {
    console.error('調薪失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT: 批次初始化所有員工薪資歷史
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
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    // 找出沒有薪資歷史的員工
    const employeesWithoutHistory = await prisma.employee.findMany({
      where: {
        isActive: true,
        salaryHistories: { none: {} }
      },
      select: { id: true, name: true }
    });

    let initialized = 0;
    const errors: string[] = [];

    for (const emp of employeesWithoutHistory) {
      const result = await initializeSalaryHistory(emp.id, user.employeeId);
      if (result.success) {
        initialized++;
      } else {
        errors.push(`${emp.name}: ${result.error}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `已初始化 ${initialized} 位員工的薪資歷史`,
      initialized,
      skipped: employeesWithoutHistory.length - initialized,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('批次初始化失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
