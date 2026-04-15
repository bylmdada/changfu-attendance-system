import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { toCsvRow } from '@/lib/csv';
import { parseIntegerQueryParam } from '@/lib/query-params';

/**
 * 銀行薪轉檔匯出 API
 * 支援元大銀行格式（之後可擴充其他銀行）
 */

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
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
    const format = searchParams.get('format') || 'json';
    const bankCode = searchParams.get('bankCode') || '806'; // 元大銀行代碼

    if (!['json', 'csv', 'txt'].includes(format)) {
      return NextResponse.json({ error: '無效的格式參數' }, { status: 400 });
    }

    if (!/^\d{3}$/.test(bankCode)) {
      return NextResponse.json({ error: '無效的銀行代碼參數' }, { status: 400 });
    }

    // 取得該月份的薪資記錄
    const payrollRecords = await prisma.payrollRecord.findMany({
      where: {
        payYear: year,
        payMonth: month
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            bankAccount: true
          }
        }
      },
      orderBy: { employeeId: 'asc' }
    });

    if (payrollRecords.length === 0) {
      return NextResponse.json({ 
        error: `${year}年${month}月沒有薪資記錄` 
      }, { status: 404 });
    }

    const records = payrollRecords.map(record => {
      return {
        employeeId: record.employee.employeeId,
        name: record.employee.name,
        department: record.employee.department,
        bankAccount: record.employee.bankAccount || '',
        netPay: Math.round(record.netPay), // 實發金額（取整數）
        grossPay: record.grossPay,
        deductions: record.totalDeductions
      };
    });

    // 統計
    const summary = {
      year,
      month,
      bankCode,
      totalRecords: records.length,
      totalAmount: records.reduce((sum, r) => sum + r.netPay, 0),
      generatedAt: new Date().toISOString()
    };

    if (format === 'txt') {
      // 元大銀行薪轉格式
      const lines: string[] = [];
      
      // 檔頭（批次資訊）
      const batchDate = `${year}${month.toString().padStart(2, '0')}25`; // 假設25日發薪
      const batchNo = '001';
      const header = [
        'H',                                           // 記錄類型
        bankCode.padEnd(3, ' '),                       // 銀行代碼
        batchDate,                                      // 批次日期
        batchNo.padStart(3, '0'),                      // 批次序號
        records.length.toString().padStart(6, '0'),   // 總筆數
        summary.totalAmount.toString().padStart(15, '0') // 總金額
      ].join('');
      lines.push(header);
      
      // 明細資料
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const detail = [
          'D',                                         // 記錄類型
          (i + 1).toString().padStart(6, '0'),        // 序號
          (r.bankAccount || '').padEnd(16, ' '),      // 帳號
          r.netPay.toString().padStart(12, '0'),      // 金額
          r.name.padEnd(20, ' ').slice(0, 20),        // 姓名
          r.employeeId.padEnd(10, ' ')                // 員工編號
        ].join('');
        lines.push(detail);
      }
      
      // 檔尾
      const trailer = [
        'T',
        records.length.toString().padStart(6, '0'),
        summary.totalAmount.toString().padStart(15, '0')
      ].join('');
      lines.push(trailer);

      const txtContent = lines.join('\r\n');
      
      return new NextResponse(txtContent, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="bank_transfer_${year}${month.toString().padStart(2, '0')}.txt"`
        }
      });
    }

    if (format === 'csv') {
      const headers = ['員工編號', '姓名', '部門', '銀行帳號', '實發金額'];
      const csvRows = [
        toCsvRow(headers),
        ...records.map(r => toCsvRow([
          r.employeeId, r.name, r.department, r.bankAccount, r.netPay
        ])),
        '',
        toCsvRow(['合計', '', '', '', summary.totalAmount])
      ];

      const csvContent = '\uFEFF' + csvRows.join('\n');
      
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="bank_transfer_${year}${month.toString().padStart(2, '0')}.csv"`
        }
      });
    }

    return NextResponse.json({
      success: true,
      period: { year, month },
      bankCode,
      records,
      summary
    });
  } catch (error) {
    console.error('匯出銀行薪轉檔失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
