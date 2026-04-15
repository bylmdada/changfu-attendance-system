'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import * as XLSX from 'xlsx';
import { validateCSRF } from '@/lib/csrf';

function parseFiniteNonNegativeNumber(value: unknown, defaultValue = 0) {
  if (value === undefined || value === null || value === '') {
    return { value: defaultValue, isValid: true };
  }

  const parsed = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, isValid: false };
  }

  return { value: parsed, isValid: true };
}

function parseImportYearValue(value: unknown) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 2000 || value > 2100) {
      return { value: null, isValid: false };
    }

    return { value, isValid: true };
  }

  if (typeof value !== 'string') {
    return { value: null, isValid: false };
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return { value: null, isValid: false };
  }

  const parsed = Number(trimmedValue);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    return { value: null, isValid: false };
  }

  return { value: parsed, isValid: true };
}

function parseExpiryDateValue(value: unknown, year: number) {
  if (value === undefined || value === null || value === '') {
    return { value: new Date(year + 1, 5, 30), isValid: true };
  }

  let parsedDate: Date;

  if (typeof value === 'number') {
    const excelDate = XLSX.SSF.parse_date_code(value);
    if (!excelDate || !excelDate.y || !excelDate.m || !excelDate.d) {
      return { value: null, isValid: false };
    }

    parsedDate = new Date(excelDate.y, excelDate.m - 1, excelDate.d);
  } else {
    parsedDate = new Date(String(value));
  }

  if (Number.isNaN(parsedDate.getTime())) {
    return { value: null, isValid: false };
  }

  return { value: parsedDate, isValid: true };
}

// POST - 批量匯入特休假餘額
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!['ADMIN', 'HR'].includes(user.role)) {
      return NextResponse.json({ error: '需要管理員或人資權限' }, { status: 403 });
    }

    // 解析 multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: '請上傳檔案' }, { status: 400 });
    }

    // 檢查檔案類型
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.csv')) {
      return NextResponse.json({ error: '僅支援 Excel (.xlsx) 或 CSV 格式' }, { status: 400 });
    }

    // 讀取檔案內容
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // 轉換為 JSON，使用第一行作為標題
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
    
    if (rawData.length < 2) {
      return NextResponse.json({ error: '檔案內容為空或格式不正確' }, { status: 400 });
    }

    // 解析標題行
    const headers = (rawData[0] as string[]).map(h => String(h).trim());
    const dataRows = rawData.slice(1).filter(row => (row as unknown[]).some(cell => cell !== undefined && cell !== ''));

    // 欄位映射
    const columnMap: Record<string, string> = {
      '員工編號': 'employeeId',
      '年度': 'year',
      '已使用天數': 'usedDays',
      '剩餘天數': 'remainingDays',
      '到期日': 'expiryDate',
    };

    const headerIndexes: Record<string, number> = {};
    headers.forEach((header, index) => {
      const mappedName = columnMap[header];
      if (mappedName) {
        headerIndexes[mappedName] = index;
      }
    });

    // 驗證必要欄位
    const requiredFields = ['employeeId', 'year', 'remainingDays'];
    const missingFields = requiredFields.filter(f => headerIndexes[f] === undefined);
    if (missingFields.length > 0) {
      return NextResponse.json({ 
        error: `缺少必要欄位：${missingFields.map(f => Object.entries(columnMap).find(([, v]) => v === f)?.[0]).join(', ')}` 
      }, { status: 400 });
    }

    // 預先查詢所有員工
    const employees = await prisma.employee.findMany({
      select: { id: true, employeeId: true, hireDate: true }
    });
    const employeeMap = new Map(employees.map(e => [e.employeeId, e]));

    // 解析資料
    const results: { success: number; failed: number; errors: string[] } = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[];
      const rowNum = i + 2; // Excel 從 1 開始，加上標題行

      try {
        const employeeIdStr = String(row[headerIndexes.employeeId] || '').trim();
        const yearResult = parseImportYearValue(row[headerIndexes.year]);

        if (!employeeIdStr) {
          results.errors.push(`第 ${rowNum} 行：員工編號為空`);
          results.failed++;
          continue;
        }

        const employee = employeeMap.get(employeeIdStr);
        if (!employee) {
          results.errors.push(`第 ${rowNum} 行：找不到員工編號 ${employeeIdStr}`);
          results.failed++;
          continue;
        }

        if (!yearResult.isValid || yearResult.value === null) {
          results.errors.push(`第 ${rowNum} 行：年度格式不正確`);
          results.failed++;
          continue;
        }

        const year = yearResult.value;

        const usedDaysResult = parseFiniteNonNegativeNumber(row[headerIndexes.usedDays], 0);
        if (!usedDaysResult.isValid || usedDaysResult.value === null) {
          results.errors.push(`第 ${rowNum} 行：已使用天數格式不正確`);
          results.failed++;
          continue;
        }

        const remainingDaysResult = parseFiniteNonNegativeNumber(row[headerIndexes.remainingDays]);
        if (!remainingDaysResult.isValid || remainingDaysResult.value === null) {
          results.errors.push(`第 ${rowNum} 行：剩餘天數格式不正確`);
          results.failed++;
          continue;
        }

        const expiryDateResult = parseExpiryDateValue(row[headerIndexes.expiryDate], year);
        if (!expiryDateResult.isValid || expiryDateResult.value === null) {
          results.errors.push(`第 ${rowNum} 行：到期日格式不正確`);
          results.failed++;
          continue;
        }

        const usedDays = usedDaysResult.value;
        const remainingDays = remainingDaysResult.value;
        const expiryDate = expiryDateResult.value;

        // 計算年資
        const hireDate = new Date(employee.hireDate);
        const yearsOfService = year - hireDate.getFullYear();
        const totalDays = usedDays + remainingDays;

        // 建立或更新特休假記錄
        await prisma.annualLeave.upsert({
          where: {
            employeeId_year: {
              employeeId: employee.id,
              year: year
            }
          },
          update: {
            usedDays,
            remainingDays,
            totalDays,
            expiryDate,
            yearsOfService: yearsOfService > 0 ? yearsOfService : 0
          },
          create: {
            employeeId: employee.id,
            year,
            yearsOfService: yearsOfService > 0 ? yearsOfService : 0,
            totalDays,
            usedDays,
            remainingDays,
            expiryDate
          }
        });

        results.success++;
      } catch (err) {
        results.errors.push(`第 ${rowNum} 行：${err instanceof Error ? err.message : '未知錯誤'}`);
        results.failed++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `匯入完成：成功 ${results.success} 筆，失敗 ${results.failed} 筆`,
      results
    });

  } catch (error) {
    console.error('特休假匯入失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// GET - 下載匯入範本
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (!['ADMIN', 'HR'].includes(user.role)) {
      return NextResponse.json({ error: '需要管理員或人資權限' }, { status: 403 });
    }

    // 建立範本
    const templateData = [
      ['員工編號', '年度', '已使用天數', '剩餘天數', '到期日'],
      ['A001', 2024, 5, 10, '2025-06-30'],
      ['A002', 2024, 3, 12, '2025-07-15'],
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    
    // 設定欄位寬度
    worksheet['!cols'] = [
      { wch: 12 }, // 員工編號
      { wch: 8 },  // 年度
      { wch: 12 }, // 已使用天數
      { wch: 12 }, // 剩餘天數
      { wch: 12 }, // 到期日
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, '特休假匯入');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="annual_leave_import_template.xlsx"'
      }
    });

  } catch (error) {
    console.error('下載範本失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
