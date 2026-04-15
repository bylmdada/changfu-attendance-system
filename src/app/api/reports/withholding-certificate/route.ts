'use strict';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { LOGO_BASE64 } from '@/lib/logoBase64';
import { decrypt } from '@/lib/encryption';
import { escapeHtml } from '@/lib/html';
import { parseIntegerQueryParam } from '@/lib/query-params';

/**
 * 年度扣繳憑單 API
 * 產生符合國稅局格式的「各類所得扣繳暨免扣繳憑單」
 */

// 取得當年度薪資資料並計算
async function calculateWithholdingData(employeeId: number, year: number) {
  const payrollRecords = await prisma.payrollRecord.findMany({
    where: {
      employeeId,
      payYear: year
    },
    orderBy: { payMonth: 'asc' }
  });

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      employeeId: true,
      name: true,
      idNumber: true,
      department: true,
    }
  });

  if (!employee || payrollRecords.length === 0) {
    return null;
  }

  // 計算年度總額
  const totals = payrollRecords.reduce((acc, record) => {
    acc.grossPay += record.grossPay;
    acc.basePay += record.basePay;
    acc.overtimePay += record.overtimePay;
    acc.laborInsurance += record.laborInsurance;
    acc.healthInsurance += record.healthInsurance;
    acc.laborPensionSelf += record.laborPensionSelf || 0;
    acc.incomeTax += record.incomeTax;
    acc.netPay += record.netPay;
    return acc;
  }, {
    grossPay: 0,
    basePay: 0,
    overtimePay: 0,
    laborInsurance: 0,
    healthInsurance: 0,
    laborPensionSelf: 0,
    incomeTax: 0,
    netPay: 0
  });

  // 計算免稅加班費（每月46小時以內免稅）
  const hourlyWage = payrollRecords[0]?.hourlyWage || 0;
  const exemptOvertimeLimit = 46 * 12 * hourlyWage; // 全年免稅加班費上限
  const exemptOvertimePay = Math.min(totals.overtimePay, exemptOvertimeLimit);
  
  // 應稅所得 = 總所得 - 勞保 - 健保 - 勞退自提 - 免稅加班費
  const taxableIncome = totals.grossPay - totals.laborInsurance - totals.healthInsurance - totals.laborPensionSelf - exemptOvertimePay;

  // 解密身分證字號並隱碼處理（格式：A***6789）
  let maskedIdNumber: string | null = null;
  if (employee.idNumber) {
    try {
      const decrypted = decrypt(employee.idNumber);
      if (decrypted && decrypted.length >= 5) {
        // 格式：首字母 + *** + 後4碼
        maskedIdNumber = decrypted.charAt(0) + '***' + decrypted.slice(-4);
      } else if (decrypted) {
        // 長度不足時直接隱碼
        maskedIdNumber = '***' + decrypted.slice(-4);
      }
    } catch (err) {
      // 解密失敗記錄 log
      console.error(`[扣繳憑單] 身分證解密失敗 (員工ID: ${employee.employeeId}):`, err);
      maskedIdNumber = null;
    }
  }

  return {
    employee: {
      id: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      idNumber: maskedIdNumber
    },
    year,
    monthsWorked: payrollRecords.length,
    totals: {
      ...totals,
      exemptOvertimePay,
      taxableIncome
    },
    records: payrollRecords.map(r => ({
      month: r.payMonth,
      grossPay: r.grossPay,
      laborInsurance: r.laborInsurance,
      healthInsurance: r.healthInsurance,
      laborPensionSelf: r.laborPensionSelf || 0,
      incomeTax: r.incomeTax,
      netPay: r.netPay
    }))
  };
}

// 產生 HTML 格式扣繳憑單
function generateHTMLCertificate(data: Awaited<ReturnType<typeof calculateWithholdingData>>) {
  if (!data) return '';

  const { employee, year, totals } = data;
  const safeEmployeeName = escapeHtml(employee.name);
  const safeEmployeeId = escapeHtml(employee.employeeId);
  const safeEmployeeDepartment = escapeHtml(employee.department || '-');
  const safeEmployeeIdNumber = employee.idNumber ? escapeHtml(employee.idNumber) : null;

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${year}年度扣繳憑單 - ${safeEmployeeName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 8mm; }
    body { 
      font-family: 'Microsoft JhengHei', -apple-system, sans-serif; 
      background: white; 
      padding: 0; 
      font-size: 11px;
      color: #333;
    }
    .certificate { 
      max-width: 210mm; 
      margin: 0 auto; 
      padding: 15px 20px;
      position: relative;
    }
    /* 浮水印 */
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 50px;
      color: rgba(100, 116, 139, 0.06);
      font-weight: bold;
      white-space: nowrap;
      pointer-events: none;
      z-index: 1000;
    }
    /* 標題區 */
    .header { 
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: white;
      padding: 2px;
    }
    .header-title h1 { font-size: 16px; margin-bottom: 2px; }
    .header-title p { font-size: 10px; opacity: 0.9; }
    .year-badge {
      background: rgba(255,255,255,0.2);
      padding: 6px 14px;
      border-radius: 15px;
      font-size: 12px;
      font-weight: 600;
    }
    /* 資訊區 */
    .info-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 12px;
    }
    .info-card {
      background: #f8fafc;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
    }
    .info-card h3 { font-size: 10px; color: #6b7280; margin-bottom: 6px; }
    .info-item { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; color: #111827; }
    /* 摘要卡片 */
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .summary-card {
      padding: 12px;
      border-radius: 8px;
      text-align: center;
    }
    .summary-card.income { background: #dcfce7; border: 1px solid #86efac; }
    .summary-card.tax { background: #fee2e2; border: 1px solid #fca5a5; }
    .summary-card.net { background: #dbeafe; border: 1px solid #93c5fd; }
    .summary-card .value { font-size: 18px; font-weight: bold; }
    .summary-card.income .value { color: #166534; }
    .summary-card.tax .value { color: #991b1b; }
    .summary-card.net .value { color: #1e40af; }
    .summary-card .label { font-size: 10px; color: #6b7280; margin-top: 2px; }
    /* 明細表 */
    .detail-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      margin-bottom: 12px;
    }
    .detail-table th, .detail-table td {
      border: 1px solid #e5e7eb;
      padding: 6px 10px;
    }
    .detail-table th { 
      background: #f1f5f9; 
      font-weight: 600; 
      text-align: center;
      color: #475569;
    }
    .detail-table td.label { background: #fafafa; }
    .detail-table td.amount { text-align: right; font-family: monospace; }
    .detail-table tr.highlight { background: #eff6ff; }
    .detail-table tr.highlight td { font-weight: 600; }
    /* 說明區 */
    .notes {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 9px;
      color: #92400e;
      margin-bottom: 12px;
    }
    .notes-title { font-weight: 600; margin-bottom: 4px; }
    /* 頁尾 */
    .footer {
      text-align: center;
      padding: 10px;
      background: #f8fafc;
      border-radius: 6px;
      font-size: 9px;
      color: #6b7280;
    }
    .confidential-notice {
      background: #fef3c7;
      color: #92400e;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 9px;
      display: inline-block;
      margin-bottom: 6px;
    }
    /* 列印按鈕 */
    .print-actions {
      position: fixed;
      top: 20px;
      right: 20px;
      display: flex;
      gap: 8px;
      z-index: 2000;
    }
    .print-btn {
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      transition: all 0.2s;
    }
    .print-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    .print-btn.primary { background: #1e40af; color: white; }
    .print-btn.secondary { background: white; color: #374151; border: 1px solid #d1d5db; }
    @media print {
      .watermark { position: fixed; }
      .certificate { padding: 10px; }
      .print-actions { display: none !important; }
    }
  </style>
</head>
<body>
  <!-- 列印按鈕 -->
  <div class="print-actions">
    <button class="print-btn primary" onclick="window.print()">
      🖨️ 列印 / 存為 PDF
    </button>
  </div>

  <div class="watermark">內部機密 僅限本人查閱</div>
  
  <div class="certificate">
    <!-- 標題區 -->
    <div class="header">
      <div class="header-left">
        <img src="${LOGO_BASE64}" alt="長福會" class="logo" />
        <div class="header-title">
          <h1>各類所得扣繳暨免扣繳憑單</h1>
          <p>社團法人宜蘭縣長期照護及社會福祉推廣協會</p>
        </div>
      </div>
      <div class="year-badge">${year}年度 (民國${year - 1911}年)</div>
    </div>

    <!-- 員工資訊 -->
    <div class="info-section">
      <div class="info-card">
        <h3>👤 所得人資料</h3>
        <div class="info-item"><span class="info-label">姓名</span><span class="info-value">${safeEmployeeName}</span></div>
        ${safeEmployeeIdNumber ? `<div class="info-item"><span class="info-label">身分證字號</span><span class="info-value">${safeEmployeeIdNumber}</span></div>` : ''}
        <div class="info-item"><span class="info-label">所屬部門</span><span class="info-value">${safeEmployeeDepartment}</span></div>
      </div>
      <div class="info-card">
        <h3>📊 所得類別</h3>
        <div class="info-item"><span class="info-label">所得代碼</span><span class="info-value">50 - 薪資所得</span></div>
        <div class="info-item"><span class="info-label">服務月數</span><span class="info-value">${data.monthsWorked} 個月</span></div>
        <div class="info-item"><span class="info-label">員工編號</span><span class="info-value">${safeEmployeeId}</span></div>
      </div>
    </div>

    <!-- 摘要卡片 -->
    <div class="summary-cards">
      <div class="summary-card income">
        <div class="value">NT$ ${totals.grossPay.toLocaleString()}</div>
        <div class="label">給付總額</div>
      </div>
      <div class="summary-card tax">
        <div class="value">NT$ ${totals.incomeTax.toLocaleString()}</div>
        <div class="label">扣繳稅額</div>
      </div>
      <div class="summary-card net">
        <div class="value">NT$ ${totals.taxableIncome.toLocaleString()}</div>
        <div class="label">應稅所得淨額</div>
      </div>
    </div>

    <!-- 明細表 -->
    <table class="detail-table">
      <thead>
        <tr><th width="35%">項目</th><th width="25%">金額</th><th width="40%">說明</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="label">薪資所得</td>
          <td class="amount">NT$ ${totals.basePay.toLocaleString()}</td>
          <td>底薪總額</td>
        </tr>
        <tr>
          <td class="label">加班費</td>
          <td class="amount">NT$ ${totals.overtimePay.toLocaleString()}</td>
          <td>加班費總額</td>
        </tr>
        <tr class="highlight">
          <td class="label">📌 給付總額</td>
          <td class="amount">NT$ ${totals.grossPay.toLocaleString()}</td>
          <td>薪資 + 加班費 + 獎金</td>
        </tr>
        <tr>
          <td class="label">勞保費 (自付)</td>
          <td class="amount">NT$ ${totals.laborInsurance.toLocaleString()}</td>
          <td>全額可扣除</td>
        </tr>
        <tr>
          <td class="label">健保費 (自付)</td>
          <td class="amount">NT$ ${totals.healthInsurance.toLocaleString()}</td>
          <td>全額可扣除</td>
        </tr>
        <tr>
          <td class="label">勞退自提</td>
          <td class="amount">NT$ ${totals.laborPensionSelf.toLocaleString()}</td>
          <td>自願提繳 (免稅)</td>
        </tr>
        <tr>
          <td class="label">免稅加班費</td>
          <td class="amount">NT$ ${totals.exemptOvertimePay.toLocaleString()}</td>
          <td>每月46小時以內</td>
        </tr>
        <tr class="highlight">
          <td class="label">📌 應稅所得淨額</td>
          <td class="amount">NT$ ${totals.taxableIncome.toLocaleString()}</td>
          <td>總額 - 免稅扣除項</td>
        </tr>
        <tr class="highlight">
          <td class="label">📌 扣繳稅額</td>
          <td class="amount" style="color: #dc2626;">NT$ ${totals.incomeTax.toLocaleString()}</td>
          <td>已預扣所得稅</td>
        </tr>
      </tbody>
    </table>

    <!-- 說明區 -->
    <div class="notes">
      <div class="notes-title">📋 報稅注意事項</div>
      <p>• 本憑單依據所得稅法規定製作，請妥善保存以供報稅使用</p>
      <p>• 勞保費、健保費、勞退自提為免稅項目，可全額列為扣除額</p>
      <p>• 每月46小時以內加班費依法免稅</p>
    </div>

    <!-- 頁尾 -->
    <div class="footer">
      <div class="confidential-notice">
        🔒 本扣繳憑單專供 ${safeEmployeeName} (${safeEmployeeId}) 查閱
      </div>
      <p>製表日期：${new Date().toLocaleDateString('zh-TW')} | 長福會考勤管理系統</p>
    </div>
  </div>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
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

    const year = yearResult.value!;
    const employeeIdParam = searchParams.get('employeeId');
    const format = searchParams.get('format') || 'json'; // json, html, pdf

    if (!['json', 'html', 'pdf'].includes(format)) {
      return NextResponse.json({ error: '無效的格式參數' }, { status: 400 });
    }

    // 權限檢查
    let targetEmployeeId: number;
    if (employeeIdParam && (user.role === 'ADMIN' || user.role === 'HR')) {
      const employeeIdResult = parseIntegerQueryParam(employeeIdParam, { min: 1 });
      if (!employeeIdResult.isValid || employeeIdResult.value === null) {
        return NextResponse.json({ error: '無效的員工編號參數' }, { status: 400 });
      }

      targetEmployeeId = employeeIdResult.value;
    } else {
      targetEmployeeId = user.employeeId;
    }

    const data = await calculateWithholdingData(targetEmployeeId, year);

    if (!data) {
      return NextResponse.json({ error: '找不到薪資資料' }, { status: 404 });
    }

    // HTML 格式
    if (format === 'html') {
      const html = generateHTMLCertificate(data);
      const filename = `${year}年度扣繳憑單_${data.employee.name}.html`;
      const encodedFilename = encodeURIComponent(filename);
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`
        }
      });
    }

    // PDF 格式（透過 HTML 轉 PDF 提示下載）
    if (format === 'pdf') {
      const html = generateHTMLCertificate(data);
      // 加入列印腳本
      const printableHtml = html.replace('</body>', `
        <script>window.onload = function() { window.print(); }</script>
      </body>`);
      return new NextResponse(printableHtml, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8'
        }
      });
    }

    // JSON 格式（預設）
    return NextResponse.json({
      success: true,
      certificate: data
    });
  } catch (error) {
    console.error('產生扣繳憑單失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
