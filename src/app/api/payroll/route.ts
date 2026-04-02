import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { calculateAllDeductions } from '@/lib/tax-calculator';
import { Prisma } from '@prisma/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { calculatePerfectAttendanceBonus } from '@/lib/perfect-attendance';

function buildEmployeeSelect(includeExtended: boolean): Prisma.EmployeeSelect {
  const employeeModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'Employee');
  const fields = new Set((employeeModel?.fields ?? []).map(f => f.name));
  const base: Record<string, boolean> = {
    id: true,
    employeeId: true,
    name: true,
    department: true,
    position: true,
    baseSalary: true,
    hourlyRate: true
  };
  if (includeExtended) {
    if (fields.has('insuredBase')) base.insuredBase = true;
    if (fields.has('dependents')) base.dependents = true;
    if (fields.has('laborPensionSelfRate')) base.laborPensionSelfRate = true;
  }
  return base as Prisma.EmployeeSelect;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    // 建立篩選條件
    const where: {
      employeeId?: number;
      payYear?: number;
      payMonth?: number;
    } = {};

    // 權限控制：員工可以查看自己的薪資記錄，管理員和HR可以查看所有記錄
    const isEmployee = user.role !== 'ADMIN' && user.role !== 'HR';
    if (isEmployee) {
      where.employeeId = user.employeeId;
    } else if (employeeId) {
      where.employeeId = parseInt(employeeId);
    }

    if (year) {
      where.payYear = parseInt(year);
    }

    if (month) {
      where.payMonth = parseInt(month);
    }

    const payrollRecords = await prisma.payrollRecord.findMany({
      where,
      include: {
        employee: {
          select: buildEmployeeSelect(isEmployee)
        }
      },
      orderBy: [
        { payYear: 'desc' },
        { payMonth: 'desc' },
        { employee: { name: 'asc' } }
      ]
    });

    return NextResponse.json({ payrollRecords });
  } catch (error) {
    console.error('獲取薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/payroll');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以創建薪資記錄
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { employeeId, payYear, payMonth } = await request.json();

    // 驗證必填欄位
    if (!employeeId || !payYear || !payMonth) {
      return NextResponse.json({ error: '員工ID、年份和月份為必填' }, { status: 400 });
    }

    // 檢查是否已存在該月份的薪資記錄
    const existingRecord = await prisma.payrollRecord.findFirst({
      where: {
        employeeId: parseInt(employeeId),
        payYear: parseInt(payYear),
        payMonth: parseInt(payMonth)
      }
    });

    if (existingRecord) {
      return NextResponse.json({ error: '該月份的薪資記錄已存在' }, { status: 400 });
    }

    // 獲取員工資訊
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) }
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到員工資訊' }, { status: 404 });
    }

    // 計算該月份的考勤記錄
    const startDate = new Date(parseInt(payYear), parseInt(payMonth) - 1, 1);
    const endDate = new Date(parseInt(payYear), parseInt(payMonth), 0);

    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        employeeId: parseInt(employeeId),
        workDate: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    // 計算總工時和加班時數
    let totalRegularHours = 0;
    let totalOvertimeHours = 0;

    attendanceRecords.forEach(record => {
      if (record.regularHours) {
        totalRegularHours += record.regularHours;
      }
      if (record.overtimeHours) {
        totalOvertimeHours += record.overtimeHours;
      }
    });

    // 計算薪資
    const basePay = employee.baseSalary;
    const overtimePay = totalOvertimeHours * employee.hourlyRate;
    
    // 計算全勤獎金
    let perfectAttendanceBonus = 0;
    try {
      const paResult = await calculatePerfectAttendanceBonus(
        employee.id,
        parseInt(payYear),
        parseInt(payMonth)
      );
      if (paResult.eligible) {
        perfectAttendanceBonus = paResult.actualAmount;
        console.log(`✅ 全勤獎金計算: ${employee.name} - ${perfectAttendanceBonus} 元 (${paResult.details})`);
      }
    } catch (paError) {
      console.warn('計算全勤獎金失敗:', paError);
    }
    
    const grossPay = basePay + overtimePay + perfectAttendanceBonus;
    
    // 查詢該月份是否有獎金記錄，並計算對應的補充保費
    let bonusSupplementaryPremium = 0;
    try {
      const bonusRecords = await prisma.bonusRecord.findMany({
        where: {
          employeeId: employee.id,
          payrollYear: parseInt(payYear),
          payrollMonth: parseInt(payMonth)
        }
      });
      
      bonusSupplementaryPremium = bonusRecords.reduce((sum, record) => sum + record.supplementaryPremium, 0);
    } catch (bonusError) {
      console.warn('查詢獎金補充保費失敗:', bonusError);
      // 獎金補充保費查詢失敗不影響主要薪資計算，繼續處理
    }
    
    // 計算稅金和扣除額 (包含獎金補充保費)
    const taxCalculation = calculateAllDeductions(
      grossPay, 
      grossPay * 12, // 年薪估算
      employee.dependents || 0,
      bonusSupplementaryPremium
    );
    const netPay = taxCalculation.netSalary;

    // 基本 payload，符合目前 Prisma Client 的型別
    const baseData: Prisma.PayrollRecordUncheckedCreateInput = {
      employeeId: parseInt(employeeId),
      payYear: parseInt(payYear),
      payMonth: parseInt(payMonth),
      regularHours: totalRegularHours,
      overtimeHours: totalOvertimeHours,
      basePay,
      overtimePay,
      grossPay,
      netPay,
      hourlyWage: employee.hourlyRate || 0,
    };

    // 動態附加可用欄位（解決 client 尚未更新造成的型別不一致）
    const payrollModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'PayrollRecord');
    const fieldSet = new Set((payrollModel?.fields ?? []).map(f => f.name));
    const extraData = {} as { [key: string]: number };
    if (fieldSet.has('laborInsurance')) extraData.laborInsurance = taxCalculation.laborInsurance;
    if (fieldSet.has('healthInsurance')) extraData.healthInsurance = taxCalculation.healthInsurance;
    if (fieldSet.has('supplementaryInsurance')) extraData.supplementaryInsurance = taxCalculation.supplementaryHealthInsurance;
    if (fieldSet.has('incomeTax')) extraData.incomeTax = taxCalculation.incomeTax;
    if (fieldSet.has('totalDeductions')) extraData.totalDeductions = taxCalculation.totalDeductions;

    const payload = { ...baseData, ...extraData } as unknown as Prisma.PayrollRecordUncheckedCreateInput;

    const payrollRecord = await prisma.payrollRecord.create({
      data: payload,
    });

    return NextResponse.json({
      success: true,
      payrollRecord,
      message: '薪資記錄創建成功'
    });
  } catch (error) {
    console.error('創建薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
