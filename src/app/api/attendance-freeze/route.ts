import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { calculateAllDeductions } from '@/lib/tax-calculator';
import { calculatePerfectAttendanceBonus } from '@/lib/perfect-attendance';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || (decoded.role !== 'ADMIN' && decoded.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const freezes = await prisma.attendanceFreeze.findMany({
      include: {
        creator: {
          select: {
            id: true,
            employeeId: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return NextResponse.json({ freezes });
  } catch (error) {
    console.error('獲取凍結設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded || (decoded.role !== 'ADMIN' && decoded.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { freezeDate, targetMonth, targetYear, description, autoCalculatePayroll } = body;

    if (!freezeDate || !targetMonth || !targetYear) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 檢查是否已經存在相同的凍結設定
    const existingFreeze = await prisma.attendanceFreeze.findFirst({
      where: {
        targetMonth,
        targetYear,
        isActive: true
      }
    });

    if (existingFreeze) {
      return NextResponse.json({ error: '該月份已經被凍結' }, { status: 400 });
    }

    const freeze = await prisma.attendanceFreeze.create({
      data: {
        freezeDate: new Date(freezeDate),
        targetMonth: parseInt(targetMonth),
        targetYear: parseInt(targetYear),
        description,
        createdBy: decoded.employeeId
      },
      include: {
        creator: {
          select: {
            id: true,
            employeeId: true,
            name: true
          }
        }
      }
    });

    // 處理薪資
    let payrollMessage = '';
    let payrollResults = { success: 0, failed: 0, skipped: 0 };
    
    try {
      // 取得所有在職員工
      const activeEmployees = await prisma.employee.findMany({
        where: { isActive: true }
      });

      // 檢查是否已有該月薪資記錄
      const existingPayrolls = await prisma.payrollRecord.findMany({
        where: {
          payYear: parseInt(targetYear),
          payMonth: parseInt(targetMonth)
        },
        select: { employeeId: true }
      });
      const existingEmployeeIds = new Set(existingPayrolls.map(p => p.employeeId));

      // 找出尚未產生薪資的員工
      const employeesNeedPayroll = activeEmployees.filter(
        e => !existingEmployeeIds.has(e.id)
      );

      payrollResults.skipped = existingPayrolls.length;

      if (autoCalculatePayroll && employeesNeedPayroll.length > 0) {
        // 自動計算薪資
        for (const employee of employeesNeedPayroll) {
          try {
            await calculateAndCreatePayroll(employee, parseInt(targetYear), parseInt(targetMonth));
            payrollResults.success++;
          } catch (calcError) {
            console.error(`計算員工 ${employee.name} 薪資失敗:`, calcError);
            payrollResults.failed++;
          }
        }

        payrollMessage = `已凍結 ${targetYear}年${targetMonth}月考勤，並自動計算薪資。成功: ${payrollResults.success} 筆，失敗: ${payrollResults.failed} 筆，已存在: ${payrollResults.skipped} 筆。`;
      } else if (employeesNeedPayroll.length > 0) {
        payrollMessage = `已凍結 ${targetYear}年${targetMonth}月考勤。尚有 ${employeesNeedPayroll.length} 位員工未產生薪資，請前往薪資管理頁面執行薪資結算。`;
      } else if (existingPayrolls.length > 0) {
        payrollMessage = `已凍結 ${targetYear}年${targetMonth}月考勤。該月已有 ${existingPayrolls.length} 筆薪資記錄。`;
      } else {
        payrollMessage = `已凍結 ${targetYear}年${targetMonth}月考勤。請前往薪資管理頁面執行薪資結算。`;
      }
    } catch (payrollError) {
      console.error('處理薪資狀態失敗:', payrollError);
      payrollMessage = '考勤已凍結，但薪資處理失敗';
    }

    return NextResponse.json({ 
      freeze,
      message: payrollMessage,
      autoPayrollTriggered: autoCalculatePayroll || false,
      payrollResults
    });
  } catch (error) {
    console.error('創建凍結設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 計算並建立單一員工的薪資記錄
async function calculateAndCreatePayroll(
  employee: { id: number; baseSalary: number; hourlyRate: number; dependents: number | null; name: string },
  payYear: number,
  payMonth: number
) {
  // 計算該月份的考勤記錄
  const startDate = new Date(payYear, payMonth - 1, 1);
  const endDate = new Date(payYear, payMonth, 0);

  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: {
      employeeId: employee.id,
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
      payYear,
      payMonth
    );
    if (paResult.eligible) {
      perfectAttendanceBonus = paResult.actualAmount;
    }
  } catch {
    // 全勤獎金計算失敗不影響主要薪資
  }
  
  const grossPay = basePay + overtimePay + perfectAttendanceBonus;
  
  // 查詢該月份是否有獎金記錄，並計算對應的補充保費
  let bonusSupplementaryPremium = 0;
  try {
    const bonusRecords = await prisma.bonusRecord.findMany({
      where: {
        employeeId: employee.id,
        payrollYear: payYear,
        payrollMonth: payMonth
      }
    });
    
    bonusSupplementaryPremium = bonusRecords.reduce((sum, record) => sum + record.supplementaryPremium, 0);
  } catch {
    // 獎金補充保費查詢失敗不影響主要薪資計算
  }
  
  // 計算稅金和扣除額
  const taxCalculation = calculateAllDeductions(
    grossPay, 
    grossPay * 12,
    employee.dependents || 0,
    bonusSupplementaryPremium
  );
  const netPay = taxCalculation.netSalary;

  // 建立薪資記錄
  const baseData: Prisma.PayrollRecordUncheckedCreateInput = {
    employeeId: employee.id,
    payYear,
    payMonth,
    regularHours: totalRegularHours,
    overtimeHours: totalOvertimeHours,
    basePay,
    overtimePay,
    grossPay,
    netPay,
    hourlyWage: employee.hourlyRate || 0,
  };

  // 動態附加可用欄位
  const payrollModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'PayrollRecord');
  const fieldSet = new Set((payrollModel?.fields ?? []).map(f => f.name));
  const extraData = {} as { [key: string]: number };
  if (fieldSet.has('laborInsurance')) extraData.laborInsurance = taxCalculation.laborInsurance;
  if (fieldSet.has('healthInsurance')) extraData.healthInsurance = taxCalculation.healthInsurance;
  if (fieldSet.has('supplementaryInsurance')) extraData.supplementaryInsurance = taxCalculation.supplementaryHealthInsurance;
  if (fieldSet.has('incomeTax')) extraData.incomeTax = taxCalculation.incomeTax;
  if (fieldSet.has('totalDeductions')) extraData.totalDeductions = taxCalculation.totalDeductions;

  const payload = { ...baseData, ...extraData } as unknown as Prisma.PayrollRecordUncheckedCreateInput;

  await prisma.payrollRecord.create({
    data: payload,
  });

  console.log(`✅ 自動建立薪資: ${employee.name} - ${payYear}/${payMonth}`);
}
