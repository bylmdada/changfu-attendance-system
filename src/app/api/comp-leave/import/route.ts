'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import * as XLSX from 'xlsx';
import { validateCSRF } from '@/lib/csrf';
import { getTaiwanYearMonth } from '@/lib/timezone';

// POST - 批量匯入補休餘額
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
    
    // 轉換為 JSON
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
      '餘額(小時)': 'balance',
      '餘額': 'balance',
      '說明': 'description',
    };

    const headerIndexes: Record<string, number> = {};
    headers.forEach((header, index) => {
      const mappedName = columnMap[header];
      if (mappedName) {
        headerIndexes[mappedName] = index;
      }
    });

    // 驗證必要欄位
    if (headerIndexes.employeeId === undefined || headerIndexes.balance === undefined) {
      return NextResponse.json({ 
        error: '缺少必要欄位：員工編號、餘額(小時)' 
      }, { status: 400 });
    }

    // 預先查詢所有員工
    const employees = await prisma.employee.findMany({
      select: { id: true, employeeId: true }
    });
    const employeeMap = new Map(employees.map(e => [e.employeeId, e]));

    // 取得當前年月
    const yearMonth = getTaiwanYearMonth();

    // 解析資料
    const results: { success: number; failed: number; errors: string[] } = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] as unknown[];
      const rowNum = i + 2;

      try {
        const employeeIdStr = String(row[headerIndexes.employeeId] || '').trim();
        const balance = parseFloat(String(row[headerIndexes.balance] || '0'));
        const description = headerIndexes.description !== undefined 
          ? String(row[headerIndexes.description] || '舊系統轉移').trim()
          : '舊系統轉移';

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

        if (isNaN(balance) || balance < 0) {
          results.errors.push(`第 ${rowNum} 行：餘額格式不正確`);
          results.failed++;
          continue;
        }

        // 使用交易確保資料一致性
        await prisma.$transaction(async (tx) => {
          // 匯入代表最新快照，先移除舊的匯入基準避免重複累加。
          await tx.compLeaveTransaction.deleteMany({
            where: {
              employeeId: employee.id,
              referenceType: 'IMPORT'
            }
          });

          // 建立或更新補休餘額
          await tx.compLeaveBalance.upsert({
            where: { employeeId: employee.id },
            update: {
              totalEarned: balance,
              totalUsed: 0,
              balance: balance,
              pendingEarn: 0,
              pendingUse: 0
            },
            create: {
              employeeId: employee.id,
              totalEarned: balance,
              totalUsed: 0,
              balance: balance,
              pendingEarn: 0,
              pendingUse: 0
            }
          });

          // 建立匯入交易記錄
          await tx.compLeaveTransaction.create({
            data: {
              employeeId: employee.id,
              transactionType: 'EARN',
              hours: balance,
              isFrozen: true,
              referenceType: 'IMPORT',
              yearMonth,
              description: `[匯入] ${description}`
            }
          });
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
    console.error('補休餘額匯入失敗:', error);
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
      ['員工編號', '餘額(小時)', '說明'],
      ['A001', 16, '舊系統轉移'],
      ['A002', 8, '舊系統轉移'],
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    
    worksheet['!cols'] = [
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, '補休餘額匯入');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="comp_leave_import_template.xlsx"'
      }
    });

  } catch (error) {
    console.error('下載範本失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
