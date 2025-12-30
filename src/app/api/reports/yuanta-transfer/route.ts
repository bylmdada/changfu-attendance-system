/**
 * 元大銀行薪轉檔匯出 API
 * 支援 Excel 格式，依部門分頁
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/database';
import { verifyToken } from '@/lib/auth';
import { decrypt } from '@/lib/encryption';
import * as XLSX from 'xlsx';

interface ExportRecord {
  transferDate: string;
  idNumber: string;
  bankAccount: string;
  amount: number;
  name: string;
  department: string;
}

/**
 * GET - 匯出元大銀行薪轉 Excel
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    const user = verifyToken(token);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString());
    const type = searchParams.get('type') || 'salary';  // salary 或 bonus
    const transferDate = searchParams.get('date') || `${year}${month.toString().padStart(2, '0')}25`;

    // 取得員工資料（含銀行帳號）
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        idNumber: true,
        bankAccount: true
      }
    });

    // 建立員工 Map
    const employeeMap = new Map(employees.map(e => [e.id, e]));

    let records: ExportRecord[] = [];

    if (type === 'salary') {
      // 取得薪資記錄
      const payrollRecords = await prisma.payrollRecord.findMany({
        where: {
          payYear: year,
          payMonth: month
        },
        select: {
          employeeId: true,
          netPay: true
        }
      });

      records = payrollRecords.map(pr => {
        const emp = employeeMap.get(pr.employeeId);
        if (!emp) return null;
        
        return {
          transferDate,
          idNumber: emp.idNumber ? decrypt(emp.idNumber) : '',
          bankAccount: emp.bankAccount || '',
          amount: Math.round(pr.netPay),
          name: emp.name,
          department: emp.department || '未分類'
        };
      }).filter((r): r is ExportRecord => r !== null && r.amount > 0);

    } else if (type === 'bonus') {
      // 取得年終獎金記錄
      const bonusRecords = await prisma.bonusRecord.findMany({
        where: {
          payrollYear: year,
          bonusType: 'YEAR_END'
        },
        select: {
          employeeId: true,
          amount: true
        }
      });

      records = bonusRecords.map(br => {
        const emp = employeeMap.get(br.employeeId);
        if (!emp) return null;
        
        return {
          transferDate,
          idNumber: emp.idNumber ? decrypt(emp.idNumber) : '',
          bankAccount: emp.bankAccount || '',
          amount: Math.round(br.amount),
          name: emp.name,
          department: emp.department || '未分類'
        };
      }).filter((r): r is ExportRecord => r !== null && r.amount > 0);
    }

    if (records.length === 0) {
      return NextResponse.json({ 
        error: `${year}年${month}月沒有${type === 'salary' ? '薪資' : '獎金'}記錄` 
      }, { status: 404 });
    }

    // 依部門分組
    const departmentGroups = new Map<string, ExportRecord[]>();
    for (const record of records) {
      const dept = record.department;
      if (!departmentGroups.has(dept)) {
        departmentGroups.set(dept, []);
      }
      departmentGroups.get(dept)!.push(record);
    }

    // 建立 Excel 工作簿
    const workbook = XLSX.utils.book_new();

    // 元大銀行格式的標題行
    const headers = [
      '轉帳日期\n(yyyymmdd)',
      '受款人身分證字號',
      '受款人帳號',
      '金額',
      ''  // 姓名（備註用）
    ];

    // 警告訊息行
    const warningRow = ['所有欄位請勿自行新增或刪除', '', '', '', ''];

    // 為每個部門建立工作表
    const sortedDepartments = Array.from(departmentGroups.keys()).sort();
    
    for (const dept of sortedDepartments) {
      const deptRecords = departmentGroups.get(dept)!;
      
      // 準備資料
      const data: (string | number)[][] = [
        warningRow,
        headers,
        ...deptRecords.map(r => [
          r.transferDate,
          r.idNumber,
          r.bankAccount,
          r.amount,
          r.name
        ])
      ];

      // 建立工作表
      const worksheet = XLSX.utils.aoa_to_sheet(data);

      // 設定欄寬
      worksheet['!cols'] = [
        { wch: 15 },  // 轉帳日期
        { wch: 15 },  // 身分證字號
        { wch: 18 },  // 銀行帳號
        { wch: 12 },  // 金額
        { wch: 10 }   // 姓名
      ];

      // 工作表名稱（部門）
      const sheetName = dept.slice(0, 31);  // Excel 工作表名稱最多31字元
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    }

    // 產生 Excel 檔案（使用 xls 格式以符合元大銀行需求）
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });

    // 產生檔名
    const typeLabel = type === 'salary' ? '薪水' : '年終';
    const filename = `元大薪轉_${typeLabel}_${year}${month.toString().padStart(2, '0')}.xls`;

    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type': 'application/vnd.ms-excel',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': excelBuffer.length.toString()
      }
    });

  } catch (error) {
    console.error('匯出元大薪轉檔失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
