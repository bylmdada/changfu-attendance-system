/**
 * 員工銀行帳戶管理 API
 * 僅限 ADMIN 和 HR 權限
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { encrypt, decrypt, maskIdNumber, maskBankAccount, validateTaiwanIdNumber } from '@/lib/encryption';

/**
 * GET - 取得所有員工銀行帳號清單
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    const user = await getUserFromToken(token);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const showFull = searchParams.get('showFull') === 'true';  // 是否顯示完整資料
    const department = searchParams.get('department');

    const whereClause: Record<string, unknown> = {
      isActive: true
    };
    if (department) {
      whereClause.department = department;
    }

    const employees = await prisma.employee.findMany({
      where: whereClause,
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        idNumber: true,
        bankCode: true,
        bankAccount: true
      },
      orderBy: [
        { department: 'asc' },
        { employeeId: 'asc' }
      ]
    });

    // 取得所有部門
    const departments = await prisma.employee.findMany({
      where: { isActive: true },
      select: { department: true },
      distinct: ['department']
    });

    const uniqueDepartments = departments
      .map(d => d.department)
      .filter((d): d is string => d !== null);

    // 處理資料顯示
    const records = employees.map(emp => ({
      id: emp.id,
      employeeId: emp.employeeId,
      name: emp.name,
      department: emp.department || '未分類',
      idNumber: showFull && emp.idNumber ? decrypt(emp.idNumber) : (emp.idNumber ? maskIdNumber(emp.idNumber) : ''),
      bankCode: emp.bankCode || '806',
      bankAccount: showFull ? (emp.bankAccount || '') : (emp.bankAccount ? maskBankAccount(emp.bankAccount) : ''),
      hasIdNumber: !!emp.idNumber,
      hasBankAccount: !!emp.bankAccount
    }));

    // 統計
    const summary = {
      totalEmployees: records.length,
      withBankAccount: records.filter(r => r.hasBankAccount).length,
      withIdNumber: records.filter(r => r.hasIdNumber).length,
      missingBankAccount: records.filter(r => !r.hasBankAccount).length,
      missingIdNumber: records.filter(r => !r.hasIdNumber).length
    };

    return NextResponse.json({
      success: true,
      departments: uniqueDepartments,
      records,
      summary
    });
  } catch (error) {
    console.error('取得銀行帳戶清單失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

/**
 * PUT - 更新員工銀行帳戶資訊
 */
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    const user = await getUserFromToken(token);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const bodyText = await request.text();
    console.log('📥 [bank-accounts] 原始 body:', bodyText);
    
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      console.log('❌ [bank-accounts] JSON 解析失敗');
      return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
    }
    
    const { employeeId, idNumber, bankCode: _bankCode, bankAccount } = body;

    console.log('📥 [bank-accounts] 解析後:', { employeeId, idNumber: idNumber ? '有' : '無', bankAccount: bankAccount ? '有' : '無' });

    if (!employeeId) {
      console.log('❌ [bank-accounts] 錯誤: 沒有提供員工ID, body=', body);
      return NextResponse.json({ error: '請提供員工ID' }, { status: 400 });
    }

    console.log('📥 [bank-accounts] 收到更新請求:', { employeeId, idNumber: idNumber ? '***' : '(空)', bankAccount: bankAccount ? '***' : '(空)' });

    // 驗證身分證字號格式 - 只檢查基本格式（1個英文字母 + 9個數字），不驗證檢查碼
    const trimmedIdNumber = idNumber?.trim()?.toUpperCase() || '';
    if (trimmedIdNumber && trimmedIdNumber.length > 0) {
      if (!/^[A-Z]\d{9}$/.test(trimmedIdNumber)) {
        console.log('❌ [bank-accounts] 身分證字號格式不正確:', trimmedIdNumber);
        return NextResponse.json({ error: '身分證字號格式不正確（應為1個英文字母加9個數字，例如：A123456789）' }, { status: 400 });
      }
      console.log('✅ [bank-accounts] 身分證字號格式正確');
    }

    // 驗證銀行帳號格式（只在有輸入時驗證）
    const cleanBankAccount = bankAccount ? String(bankAccount).replace(/\D/g, '') : '';
    if (cleanBankAccount && (cleanBankAccount.length < 10 || cleanBankAccount.length > 16)) {
      console.log('❌ [bank-accounts] 銀行帳號格式不正確:', cleanBankAccount.length, '位');
      return NextResponse.json({ error: '銀行帳號格式不正確（應為10-16位數字）' }, { status: 400 });
    }

    const updateData: Record<string, string | null> = {};
    
    // 只在有輸入有效值時才更新
    if (trimmedIdNumber && trimmedIdNumber.length === 10) {
      updateData.idNumber = encrypt(trimmedIdNumber);
      console.log('✅ [bank-accounts] 將更新身分證字號');
    }
    if (cleanBankAccount && cleanBankAccount.length >= 10) {
      updateData.bankAccount = cleanBankAccount;
      updateData.bankCode = '806';
      console.log('✅ [bank-accounts] 將更新銀行帳號');
    }

    // 如果沒有任何要更新的資料
    if (Object.keys(updateData).length === 0) {
      console.log('❌ [bank-accounts] 沒有有效資料可更新');
      return NextResponse.json({ error: '請輸入有效的身分證字號（10碼）或銀行帳號（10-16位）' }, { status: 400 });
    }

    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: updateData,
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true
      }
    });

    return NextResponse.json({
      success: true,
      message: `已更新 ${updated.name} 的銀行帳戶資訊`,
      employee: updated
    });
  } catch (error) {
    console.error('更新銀行帳戶失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

/**
 * POST - 批次匯入銀行帳戶資訊
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    const user = await getUserFromToken(token);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { records } = body;

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: '請提供匯入資料' }, { status: 400 });
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: { name: string; error: string }[] = [];

    for (const record of records) {
      try {
        const { idNumber, bankAccount, name } = record;

        // 透過身分證字號或姓名找到員工
        let employee = null;
        
        if (idNumber) {
          // 先查詢所有員工並解密比對
          const allEmployees = await prisma.employee.findMany({
            where: { isActive: true },
            select: { id: true, name: true, idNumber: true }
          });
          
          employee = allEmployees.find(emp => {
            if (!emp.idNumber) return false;
            return decrypt(emp.idNumber) === idNumber;
          });
        }
        
        if (!employee && name) {
          employee = await prisma.employee.findFirst({
            where: { name, isActive: true },
            select: { id: true, name: true, idNumber: true }
          });
        }

        if (!employee) {
          errors.push({ name: name || idNumber || '未知', error: '找不到對應員工' });
          errorCount++;
          continue;
        }

        // 更新資料
        const updateData: Record<string, string | null> = {};
        
        if (idNumber && !employee.idNumber) {
          if (validateTaiwanIdNumber(idNumber)) {
            updateData.idNumber = encrypt(idNumber);
          }
        }
        
        if (bankAccount) {
          updateData.bankAccount = bankAccount.replace(/[,\s]/g, ''); // 移除逗號和空白
          updateData.bankCode = '806';  // 元大銀行
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.employee.update({
            where: { id: employee.id },
            data: updateData
          });
          successCount++;
        }
      } catch (err) {
        errors.push({ name: record.name || '未知', error: String(err) });
        errorCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `匯入完成：成功 ${successCount} 筆，失敗 ${errorCount} 筆`,
      successCount,
      errorCount,
      errors: errors.slice(0, 10)  // 只返回前10個錯誤
    });
  } catch (error) {
    console.error('批次匯入失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
