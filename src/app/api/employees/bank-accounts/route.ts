/**
 * 員工銀行帳戶管理 API
 * 僅限 ADMIN 和 HR 權限
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { encrypt, decrypt, maskIdNumber, maskBankAccount, validateTaiwanIdNumber } from '@/lib/encryption';

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdNumber(value: unknown): string {
  return normalizeOptionalString(value).toUpperCase();
}

function normalizeEmployeeLookupName(value: unknown): string {
  return normalizeOptionalString(value)
    .replace(/[\s\u3000()（）\-－_.．]/g, '')
    .toLowerCase();
}

function normalizeBankAccount(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  return String(value).replace(/\D/g, '');
}

function isValidIdNumberFormat(idNumber: string): boolean {
  return /^[A-Z]\d{9}$/.test(idNumber);
}

function isValidBankAccountFormat(bankAccount: string): boolean {
  return bankAccount.length >= 10 && bankAccount.length <= 16;
}

/**
 * GET - 取得所有員工銀行帳號清單
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
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
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: csrfValidation.error }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success || !parsedBody.data) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const body = parsedBody.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const { employeeId, idNumber, bankAccount } = body;

    const normalizedEmployeeId = parsePositiveInteger(employeeId);
    if (normalizedEmployeeId === null) {
      return NextResponse.json({ error: '員工ID格式無效' }, { status: 400 });
    }

    // 驗證身分證字號格式 - 只檢查基本格式（1個英文字母 + 9個數字），不驗證檢查碼
    const trimmedIdNumber = normalizeIdNumber(idNumber);
    if (trimmedIdNumber && trimmedIdNumber.length > 0) {
      if (!isValidIdNumberFormat(trimmedIdNumber)) {
        return NextResponse.json({ error: '身分證字號格式不正確（應為1個英文字母加9個數字，例如：A123456789）' }, { status: 400 });
      }

      if (!validateTaiwanIdNumber(trimmedIdNumber)) {
        return NextResponse.json({ error: '身分證字號格式不正確（檢查碼錯誤）' }, { status: 400 });
      }
    }

    // 驗證銀行帳號格式（只在有輸入時驗證）
    const cleanBankAccount = normalizeBankAccount(bankAccount);
    if (cleanBankAccount && !isValidBankAccountFormat(cleanBankAccount)) {
      return NextResponse.json({ error: '銀行帳號格式不正確（應為10-16位數字）' }, { status: 400 });
    }

    const updateData: Record<string, string | null> = {};
    
    // 只在有輸入有效值時才更新
    if (trimmedIdNumber && trimmedIdNumber.length === 10) {
      updateData.idNumber = encrypt(trimmedIdNumber);
    }
    if (cleanBankAccount && isValidBankAccountFormat(cleanBankAccount)) {
      updateData.bankAccount = cleanBankAccount;
      updateData.bankCode = '806';
    }

    // 如果沒有任何要更新的資料
    if (Object.keys(updateData).length === 0) {
      console.log('❌ [bank-accounts] 沒有有效資料可更新');
      return NextResponse.json({ error: '請輸入有效的身分證字號（10碼）或銀行帳號（10-16位）' }, { status: 400 });
    }

    const updated = await prisma.employee.update({
      where: { id: normalizedEmployeeId },
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
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: csrfValidation.error }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success || !parsedBody.data) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const { records } = parsedBody.data as { records?: unknown[] };

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: '請提供匯入資料' }, { status: 400 });
    }

    const activeEmployees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, name: true, idNumber: true, bankAccount: true },
      orderBy: { id: 'asc' },
    });
    const employeesByName = new Map<string, Array<(typeof activeEmployees)[number]>>();
    const employeeByIdNumber = new Map<string, (typeof activeEmployees)[number]>();

    for (const employee of activeEmployees) {
      const normalizedEmployeeName = normalizeEmployeeLookupName(employee.name);
      if (normalizedEmployeeName) {
        const matchedEmployees = employeesByName.get(normalizedEmployeeName) ?? [];
        matchedEmployees.push(employee);
        employeesByName.set(normalizedEmployeeName, matchedEmployees);
      }

      if (employee.idNumber) {
        employeeByIdNumber.set(decrypt(employee.idNumber), employee);
      }
    }

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors: { name: string; error: string }[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const updatedEmployees: { id: number; name: string }[] = [];

    for (const record of records) {
      try {
        if (!record || typeof record !== 'object') {
          errors.push({ name: '未知', error: '匯入資料格式無效' });
          errorCount++;
          continue;
        }

        const { idNumber, bankAccount, name } = record as Record<string, unknown>;
        const normalizedName = normalizeOptionalString(name) || '未知';
        const normalizedLookupName = normalizeEmployeeLookupName(name);
        const normalizedIdNumber = normalizeIdNumber(idNumber);
        const normalizedBankAccount = normalizeBankAccount(bankAccount);

        if (normalizedIdNumber && !isValidIdNumberFormat(normalizedIdNumber)) {
          errors.push({ name: normalizedName, error: '身分證字號格式不正確（應為1個英文字母加9個數字）' });
          errorCount++;
          continue;
        }

        if (normalizedIdNumber && !validateTaiwanIdNumber(normalizedIdNumber)) {
          errors.push({ name: normalizedName, error: '身分證字號格式不正確（檢查碼錯誤）' });
          errorCount++;
          continue;
        }

        if (normalizedBankAccount && !isValidBankAccountFormat(normalizedBankAccount)) {
          errors.push({ name: normalizedName, error: '銀行帳號格式不正確（應為10-16位數字）' });
          errorCount++;
          continue;
        }

        if (!normalizedIdNumber && !normalizedBankAccount) {
          errors.push({ name: normalizedName, error: '請提供有效的身分證字號或銀行帳號' });
          errorCount++;
          continue;
        }

        // 透過身分證字號或姓名找到員工
        let employee = null;

        if (normalizedIdNumber) {
          employee = employeeByIdNumber.get(normalizedIdNumber) ?? null;
        }

        if (!employee && normalizedLookupName) {
          const matchedEmployees = employeesByName.get(normalizedLookupName) ?? [];
          if (matchedEmployees.length > 1) {
            skipped.push({
              name: normalizedName,
              reason: `姓名「${normalizedName}」對應到多位員工，請補齊身分證字號後再匯入，避免匯錯帳號`
            });
            skippedCount++;
            continue;
          }

          if (matchedEmployees.length === 1) {
            employee = matchedEmployees[0];
          } else {
            const fuzzyMatches = activeEmployees.filter((candidate) => {
              const candidateName = normalizeEmployeeLookupName(candidate.name);
              return candidateName && (
                candidateName.includes(normalizedLookupName) ||
                normalizedLookupName.includes(candidateName)
              );
            });

            if (fuzzyMatches.length === 1) {
              employee = fuzzyMatches[0];
            } else if (fuzzyMatches.length > 1) {
              skipped.push({
                name: normalizedName,
                reason: `姓名「${normalizedName}」可對應多位相近員工，請補齊身分證字號後再匯入`
              });
              skippedCount++;
              continue;
            }
          }
        }

        if (!employee) {
          skipped.push({ name: normalizedName || normalizedIdNumber || '未知', reason: '找不到可唯一對應的員工，已自動略過避免匯錯資料' });
          skippedCount++;
          continue;
        }

        // 更新資料
        const updateData: Record<string, string | null> = {};
        const existingIdNumber = employee.idNumber ? decrypt(employee.idNumber).toUpperCase() : '';
        const existingBankAccount = normalizeBankAccount(employee.bankAccount);
         
        if (normalizedIdNumber && existingIdNumber && existingIdNumber !== normalizedIdNumber) {
          errors.push({ name: employee.name || normalizedName, error: '匯入的身分證字號與系統現有資料不一致，已停止更新以避免覆蓋錯誤資料' });
          errorCount++;
          continue;
        }

        if (normalizedIdNumber && !employee.idNumber) {
          updateData.idNumber = encrypt(normalizedIdNumber);
        }
         
        if (normalizedBankAccount && existingBankAccount && existingBankAccount !== normalizedBankAccount) {
          updateData.bankAccount = normalizedBankAccount;
          updateData.bankCode = '806';  // 元大銀行
        } else if (normalizedBankAccount && !existingBankAccount) {
          updateData.bankAccount = normalizedBankAccount;
          updateData.bankCode = '806';  // 元大銀行
        }

        if (Object.keys(updateData).length === 0) {
          skippedCount++;
          continue;
        }

        await prisma.employee.update({
          where: { id: employee.id },
          data: updateData
        });
        updatedEmployees.push({ id: employee.id, name: employee.name });
        successCount++;
      } catch (err) {
        const recordName = typeof record === 'object' && record !== null && 'name' in record
          ? normalizeOptionalString((record as Record<string, unknown>).name)
          : '';
        errors.push({ name: recordName || '未知', error: String(err) });
        errorCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `匯入完成：成功 ${successCount} 筆，略過 ${skippedCount} 筆，失敗 ${errorCount} 筆`,
      successCount,
      skippedCount,
      errorCount,
      errors: errors.slice(0, 10),  // 只返回前10個錯誤
      skipped: skipped.slice(0, 10),
      updatedEmployees
    });
  } catch (error) {
    console.error('批次匯入失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
