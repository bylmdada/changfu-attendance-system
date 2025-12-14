import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { 
  calculateMonthlyPayroll, 
  validatePayrollCalculation,
  type EmployeePayrollInfo,
  type AttendanceForPayroll
} from '@/lib/payroll-calculator';
import { OvertimeType } from '@/lib/overtime-calculator';

export async function POST(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以批量生成薪資記錄
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { payYear, payMonth, employeeIds } = await request.json();

    // 驗證必填欄位
    if (!payYear || !payMonth) {
      return NextResponse.json({ error: '年份和月份為必填' }, { status: 400 });
    }

    const year = parseInt(payYear);
    const month = parseInt(payMonth);

    // 如果沒有指定員工，則為所有活躍員工生成薪資記錄
    let employees;
    if (employeeIds && employeeIds.length > 0) {
      employees = await prisma.employee.findMany({
        where: {
          id: { in: employeeIds.map((id: string) => parseInt(id)) },
          isActive: true
        }
      });
    } else {
      employees = await prisma.employee.findMany({
        where: { isActive: true }
      });
    }

    if (employees.length === 0) {
      return NextResponse.json({ error: '找不到符合條件的員工' }, { status: 400 });
    }

    // 計算該月份的日期範圍
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const results = [];
    const errors = [];

    for (const employee of employees) {
      try {
        // 檢查是否已存在該月份的薪資記錄
        const existingRecord = await prisma.payrollRecord.findFirst({
          where: {
            employeeId: employee.id,
            payYear: year,
            payMonth: month
          }
        });

        if (existingRecord) {
          errors.push(`員工 ${employee.name} (${employee.employeeId}) 的 ${year}年${month}月 薪資記錄已存在`);
          continue;
        }

        // 獲取該員工該月份的考勤記錄
        const attendanceRecords = await prisma.attendanceRecord.findMany({
          where: {
            employeeId: employee.id,
            workDate: {
              gte: startDate,
              lte: endDate
            }
          }
        });

        // 轉換考勤記錄格式以符合新計算器需求
        const attendanceForPayroll: AttendanceForPayroll[] = attendanceRecords.map(record => {
          // 判斷加班類型
          let overtimeType = OvertimeType.WEEKDAY;
          const dayOfWeek = record.workDate.getDay();
          
          // 簡化判斷：週六為休息日，週日為例假日
          if (dayOfWeek === 6) {
            overtimeType = OvertimeType.REST_DAY;
          } else if (dayOfWeek === 0) {
            overtimeType = OvertimeType.MANDATORY_REST;
          }
          
          // TODO: 這裡應該整合國定假日資料庫來正確判斷假日類型
          
          return {
            workDate: record.workDate,
            regularHours: record.regularHours || 0,
            overtimeHours: record.overtimeHours || 0,
            overtimeType,
            isHoliday: false, // TODO: 整合假日資料
            isRestDay: dayOfWeek === 6,
            isMandatoryRest: dayOfWeek === 0
          };
        });

        // 準備員工薪資計算資訊
        const employeeInfo: EmployeePayrollInfo = {
          id: employee.id,
          employeeId: employee.employeeId,
          name: employee.name,
          baseSalary: employee.baseSalary,
          hourlyRate: employee.hourlyRate,
          department: employee.department || '',
          position: employee.position || '',
          dependents: employee.dependents || 0,
          insuredBase: employee.insuredBase || undefined
        };

        // 使用新的薪資計算器
        const payrollResult = calculateMonthlyPayroll(
          employeeInfo,
          attendanceForPayroll,
          year,
          month
        );

        // 驗證計算結果
        const validation = validatePayrollCalculation(payrollResult);
        if (!validation.isValid) {
          errors.push(`員工 ${employee.name} 薪資計算驗證失敗: ${validation.errors.join(', ')}`);
          continue;
        }

        // 創建薪資記錄（使用現有schema，暫時簡化）
        const payrollRecord = await prisma.payrollRecord.create({
          data: {
            employeeId: employee.id,
            payYear: year,
            payMonth: month,
            regularHours: payrollResult.regularHours,
            overtimeHours: payrollResult.totalOvertimeHours,
            hourlyWage: employee.hourlyRate || 0, // 添加缺少的欄位
            basePay: payrollResult.basePay,
            overtimePay: payrollResult.totalOvertimePay,
            grossPay: payrollResult.grossPay,
            laborInsurance: payrollResult.deductions.laborInsurance,
            healthInsurance: payrollResult.deductions.healthInsurance,
            supplementaryInsurance: payrollResult.deductions.supplementaryInsurance,
            incomeTax: payrollResult.deductions.incomeTax,
            totalDeductions: payrollResult.totalDeductions,
            netPay: payrollResult.netPay
          },
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
          }
        });

        results.push(payrollRecord);
      } catch (error) {
        console.error(`為員工 ${employee.name} 生成薪資記錄失敗:`, error);
        errors.push(`員工 ${employee.name} (${employee.employeeId}) 薪資記錄生成失敗`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `成功生成 ${results.length} 筆薪資記錄`,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('批量生成薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
