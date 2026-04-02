import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { id } = await params;
    const payrollId = parseInt(id);

    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: payrollId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            baseSalary: true,
            hourlyRate: true
          }
        }
      }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    // 檢查權限：一般員工只能查看自己的薪資記錄
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR' && 
        payrollRecord.employeeId !== decoded.employeeId) {
      return NextResponse.json({ error: '無權限查看此記錄' }, { status: 403 });
    }

    return NextResponse.json({ payrollRecord });
  } catch (error) {
    console.error('獲取薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 只有管理員和HR可以更新薪資記錄
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { id } = await params;
    const payrollId = parseInt(id);
    const { regularHours, overtimeHours, basePay, overtimePay } = await request.json();

    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: payrollId }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    // 計算新的總薪資
    const newGrossPay = (basePay || payrollRecord.basePay) + (overtimePay || payrollRecord.overtimePay);
    const newNetPay = newGrossPay; // 簡化計算

    const updatedPayrollRecord = await prisma.payrollRecord.update({
      where: { id: payrollId },
      data: {
        ...(regularHours !== undefined && { regularHours }),
        ...(overtimeHours !== undefined && { overtimeHours }),
        ...(basePay !== undefined && { basePay }),
        ...(overtimePay !== undefined && { overtimePay }),
        grossPay: newGrossPay,
        netPay: newNetPay
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            baseSalary: true,
            hourlyRate: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      payrollRecord: updatedPayrollRecord,
      message: '薪資記錄更新成功'
    });
  } catch (error) {
    console.error('更新薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 只有管理員可以刪除薪資記錄
    if (decoded.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { id } = await params;
    const payrollId = parseInt(id);

    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: payrollId }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    await prisma.payrollRecord.delete({
      where: { id: payrollId }
    });

    return NextResponse.json({
      success: true,
      message: '薪資記錄已刪除'
    });
  } catch (error) {
    console.error('刪除薪資記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
