/**
 * 元大銀行薪轉檔匯出 API
 * 支援 JSON 預覽與 Excel 匯出，格式對齊銀行帳戶管理中的匯入範本
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { decrypt, validateTaiwanIdNumber } from '@/lib/encryption';
import * as XLSX from 'xlsx';
import { isValidCompactDate, parseIntegerQueryParam } from '@/lib/query-params';

interface ExportRecord {
  employeeId: string;
  transferDate: string;
  idNumber: string;
  bankAccount: string;
  amount: number | null;
  name: string;
  department: string;
}

interface ValidationErrorDetail {
  employeeId: string;
  name: string;
  department: string;
  reasons: string[];
}

function normalizeBankAccount(bankAccount: string | null | undefined) {
  return String(bankAccount ?? '').replace(/\D/g, '');
}

function isValidBankAccount(bankAccount: string) {
  return bankAccount.length >= 10 && bankAccount.length <= 16;
}

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
    const yearResult = parseIntegerQueryParam(searchParams.get('year'), {
      defaultValue: new Date().getFullYear(),
      min: 1900,
      max: 9999,
    });
    if (!yearResult.isValid) {
      return NextResponse.json({ error: '無效的年份參數' }, { status: 400 });
    }

    const monthResult = parseIntegerQueryParam(searchParams.get('month'), {
      defaultValue: new Date().getMonth() + 1,
      min: 1,
      max: 12,
    });
    if (!monthResult.isValid) {
      return NextResponse.json({ error: '無效的月份參數' }, { status: 400 });
    }

    const year = yearResult.value!;
    const month = monthResult.value!;
    const type = searchParams.get('type') || 'salary';
    const format = searchParams.get('format') || 'xls';

    if (!['salary', 'bonus'].includes(type)) {
      return NextResponse.json({ error: '無效的匯出類型參數' }, { status: 400 });
    }

    if (!['json', 'xls'].includes(format)) {
      return NextResponse.json({ error: '無效的格式參數' }, { status: 400 });
    }

    const transferDateParam = searchParams.get('date');
    if (transferDateParam && !isValidCompactDate(transferDateParam)) {
      return NextResponse.json({ error: '無效的轉帳日期參數' }, { status: 400 });
    }

    const transferDate = transferDateParam || `${year}${month.toString().padStart(2, '0')}25`;

    let payrollLikeRecords: Array<{
      employeeId: number;
      amount: number;
      employee: {
        id: number;
        employeeId: string;
        name: string;
        department: string | null;
        idNumber: string | null;
        bankAccount: string | null;
      } | null;
    }> = [];

    if (type === 'salary') {
      const payrollRecords = await prisma.payrollRecord.findMany({
        where: {
          payYear: year,
          payMonth: month,
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              department: true,
              idNumber: true,
              bankAccount: true,
            },
          },
        },
        orderBy: { employeeId: 'asc' },
      });

      payrollLikeRecords = payrollRecords.map((record) => ({
        employeeId: record.employeeId,
        amount: record.netPay,
        employee: record.employee,
      }));
    } else {
      const bonusRecords = await prisma.bonusRecord.findMany({
        where: {
          payrollYear: year,
          payrollMonth: month,
          bonusType: 'YEAR_END',
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              department: true,
              idNumber: true,
              bankAccount: true,
            },
          },
        },
        orderBy: { employeeId: 'asc' },
      });

      payrollLikeRecords = bonusRecords.map((record) => ({
        employeeId: record.employeeId,
        amount: record.amount,
        employee: record.employee,
      }));
    }

    if (payrollLikeRecords.length === 0) {
      return NextResponse.json({
        error: `${year}年${month}月沒有${type === 'salary' ? '薪資' : '獎金'}記錄`
      }, { status: 404 });
    }

    const records: ExportRecord[] = [];
    const validationErrors: ValidationErrorDetail[] = [];

    for (const record of payrollLikeRecords) {
      const employee = record.employee;
      if (!employee) {
        validationErrors.push({
          employeeId: String(record.employeeId),
          name: '未知員工',
          department: '未分類',
          reasons: ['找不到對應員工資料'],
        });
        continue;
      }

      const reasons: string[] = [];
      const decryptedIdNumber = employee.idNumber ? decrypt(employee.idNumber).trim().toUpperCase() : '';
      const normalizedBankAccount = normalizeBankAccount(employee.bankAccount);
      const roundedAmount = Math.round(record.amount);
      const hasValidAmount = Number.isFinite(record.amount) && roundedAmount > 0;

      if (!decryptedIdNumber) {
        reasons.push('缺少身分證字號');
      } else if (!/^[A-Z]\d{9}$/.test(decryptedIdNumber) || !validateTaiwanIdNumber(decryptedIdNumber)) {
        reasons.push('身分證字號格式不正確');
      }

      if (!normalizedBankAccount) {
        reasons.push('缺少薪轉元大銀行帳號');
      } else if (!isValidBankAccount(normalizedBankAccount)) {
        reasons.push('薪轉元大銀行帳號格式不正確');
      }

      if (!hasValidAmount) {
        reasons.push('實領薪資必須大於 0');
      }

      if (reasons.length > 0) {
        validationErrors.push({
          employeeId: employee.employeeId,
          name: employee.name,
          department: employee.department || '未分類',
          reasons,
        });
      }

      records.push({
        employeeId: employee.employeeId,
        transferDate,
        idNumber: !decryptedIdNumber || reasons.includes('身分證字號格式不正確') ? '' : decryptedIdNumber,
        bankAccount: !normalizedBankAccount || reasons.includes('薪轉元大銀行帳號格式不正確') ? '' : normalizedBankAccount,
        amount: hasValidAmount ? roundedAmount : null,
        name: employee.name,
        department: employee.department || '未分類',
      });
    }

    records.sort((left, right) => {
      const departmentCompare = left.department.localeCompare(right.department, 'zh-Hant');
      if (departmentCompare !== 0) return departmentCompare;
      const employeeIdCompare = left.employeeId.localeCompare(right.employeeId, 'zh-Hant', { numeric: true });
      if (employeeIdCompare !== 0) return employeeIdCompare;
      return left.name.localeCompare(right.name, 'zh-Hant');
    });

    const summary = {
      year,
      month,
      type,
      transferDate,
      totalRecords: records.length,
      totalAmount: records.reduce((sum, item) => sum + (item.amount ?? 0), 0),
      incompleteRecords: validationErrors.length,
      generatedAt: new Date().toISOString(),
    };

    if (format === 'json') {
      return NextResponse.json({
        success: true,
        records,
        warnings: validationErrors,
        summary,
      });
    }

    const departmentGroups = new Map<string, ExportRecord[]>();
    for (const record of records) {
      if (!departmentGroups.has(record.department)) {
        departmentGroups.set(record.department, []);
      }
      departmentGroups.get(record.department)!.push(record);
    }

    const workbook = XLSX.utils.book_new();
    const headers = [
      '轉帳日期(yyyymmdd)',
      '受款人身分證字號',
      '受款人帳號',
      '金額',
      '姓名',
    ];
    const warningRow = ['所有欄位請勿自行新增或刪除', '', '', '', ''];

    for (const department of Array.from(departmentGroups.keys()).sort((a, b) => a.localeCompare(b, 'zh-Hant'))) {
      const data: (string | number)[][] = [
        warningRow,
        headers,
        ...departmentGroups.get(department)!.map((item) => [
          item.transferDate,
          item.idNumber,
          item.bankAccount,
          item.amount ?? '',
          item.name,
        ]),
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(data);
      worksheet['!cols'] = [
        { wch: 18 },
        { wch: 16 },
        { wch: 18 },
        { wch: 12 },
        { wch: 12 },
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, department.slice(0, 31));
    }

    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });
    const typeLabel = type === 'salary' ? '薪水' : '年終';
    const filename = `元大薪轉_${typeLabel}_${year}${month.toString().padStart(2, '0')}.xls`;

    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.ms-excel',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': excelBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('匯出元大薪轉檔失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
