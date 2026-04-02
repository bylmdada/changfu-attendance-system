import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { getEmployeePDFPassword, getPasswordHint, PDFSecurityConfig, getDefaultSecurityConfig } from '@/lib/pdf-security';
import { LOGO_BASE64 } from '@/lib/logoBase64';

interface PayslipData {
  companyInfo: {
    name: string;
    address?: string;
    tel?: string;
  };
  employee: {
    employeeId: string;
    name: string;
    department: string | null;
    position: string | null;
  };
  period: {
    year: number;
    month: number;
    monthName: string;
  };
  workHours: {
    regular: number;
    overtime: number;
    total: number;
  };
  salary: {
    basePay: number;
    overtimePay: number;
    grossPay: number;
  };
  deductions: {
    laborInsurance: number;
    healthInsurance: number;
    supplementaryInsurance: number;
    incomeTax: number;
    total: number;
  };
  netPay: number;
  generatedAt: string;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = user;
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const payrollId = searchParams.get('payrollId');

    if (!payrollId) {
      return NextResponse.json({ error: '請提供薪資記錄ID' }, { status: 400 });
    }

    // 獲取薪資記錄
    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: parseInt(payrollId) },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            baseSalary: true
          }
        }
      }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    // 權限檢查：一般員工只能查看自己的薪資條
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR' && 
        payrollRecord.employeeId !== decoded.employeeId) {
      return NextResponse.json({ error: '無權限查看此薪資條' }, { status: 403 });
    }

    // 生成薪資條數據
    const payslipData = {
      companyInfo: {
        name: '長福會'
      },
      employee: {
        employeeId: payrollRecord.employee.employeeId,
        name: payrollRecord.employee.name,
        department: payrollRecord.employee.department,
        position: payrollRecord.employee.position
      },
      period: {
        year: payrollRecord.payYear,
        month: payrollRecord.payMonth,
        monthName: `${payrollRecord.payYear}年${payrollRecord.payMonth}月`
      },
      workHours: {
        regular: payrollRecord.regularHours,
        overtime: payrollRecord.overtimeHours,
        total: payrollRecord.regularHours + payrollRecord.overtimeHours
      },
      salary: {
        basePay: payrollRecord.basePay,
        overtimePay: payrollRecord.overtimePay,
        grossPay: payrollRecord.grossPay
      },
      deductions: {
        laborInsurance: payrollRecord.laborInsurance,
        healthInsurance: payrollRecord.healthInsurance,
        supplementaryInsurance: payrollRecord.supplementaryInsurance,
        incomeTax: payrollRecord.incomeTax,
        total: payrollRecord.totalDeductions
      },
      netPay: payrollRecord.netPay,
      generatedAt: new Date().toISOString()
    };

    // 生成HTML內容
    const htmlContent = generatePayslipHTML(payslipData);

    // 查詢該範本的安全設定
    let securityConfig: PDFSecurityConfig = getDefaultSecurityConfig();
    let passwordInfo: { hasPassword: boolean; password?: string; hint?: string } = { hasPassword: false };

    try {
      // 查詢範本設定
      const templateSetting = await prisma.systemSettings.findFirst({
        where: { key: 'payslipTemplate' }
      });

      if (templateSetting?.value) {
        const template = JSON.parse(templateSetting.value);
        if (template.securityConfig) {
          securityConfig = template.securityConfig;
        }
      }

      // 取得密碼
      if (securityConfig.passwordProtected) {
        const password = await getEmployeePDFPassword(payrollRecord.employeeId, securityConfig);
        if (password) {
          passwordInfo = {
            hasPassword: true,
            password,
            hint: getPasswordHint(securityConfig.passwordType)
          };
        }
      }
    } catch (securityError) {
      console.warn('查詢安全設定失敗:', securityError);
    }

    // 返回HTML內容供前端生成PDF
    return NextResponse.json({
      success: true,
      htmlContent,
      payslipData,
      fileName: `薪資條_${payslipData.employee.name}_${payslipData.period.monthName}.pdf`,
      security: passwordInfo
    });

  } catch (error) {
    console.error('生成PDF薪資條失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

function generatePayslipHTML(payslip: PayslipData) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>薪資條 - ${payslip.employee.name} - ${payslip.period.monthName}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @page { size: A4; margin: 10mm; }
        body { 
          font-family: 'Microsoft JhengHei', '微軟正黑體', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
          background: white;
          padding: 0;
          color: #333;
          font-size: 12px;
        }
        .payslip-container {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          position: relative;
        }
        /* 浮水印 */
        .watermark {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg);
          font-size: 60px;
          color: rgba(100, 116, 139, 0.08);
          font-weight: bold;
          white-space: nowrap;
          pointer-events: none;
          z-index: 10;
          user-select: none;
        }
        .content { position: relative; z-index: 1; }
        /* 標題區 */
        .header {
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
          color: white;
          padding: 12px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .header-left { display: flex; align-items: center; gap: 10px; }
        .logo {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          object-fit: cover;
          background: white;
          padding: 2px;
        }
        .header-title h1 { font-size: 18px; margin-bottom: 2px; }
        .header-title p { font-size: 11px; opacity: 0.9; }
        .period-badge {
          background: rgba(255,255,255,0.2);
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }
        /* 員工資訊區 */
        .employee-info {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          padding: 12px 20px;
          background: #f8fafc;
          border-bottom: 1px solid #e5e7eb;
        }
        .info-card {
          background: white;
          padding: 10px;
          border-radius: 6px;
          border: 1px solid #e5e7eb;
        }
        .info-card h3 {
          font-size: 11px;
          color: #6b7280;
          margin-bottom: 6px;
        }
        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 3px 0;
          font-size: 11px;
        }
        .info-label { color: #6b7280; }
        .info-value { font-weight: 500; color: #111827; }
        /* 薪資明細區 */
        .salary-section { padding: 12px 20px; }
        .section-header {
          padding: 6px 12px;
          border-radius: 4px 4px 0 0;
          font-weight: 600;
          font-size: 11px;
        }
        .section-header.income { background: #dcfce7; color: #166534; }
        .section-header.deduction { background: #fee2e2; color: #991b1b; }
        .salary-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          border: 1px solid #e5e7eb;
          border-top: none;
        }
        .salary-table td {
          padding: 6px 12px;
          border-bottom: 1px solid #e5e7eb;
          color: #374151;
        }
        .salary-table td:last-child { text-align: right; }
        .salary-table .income-amount { color: #059669; font-weight: 500; }
        .salary-table .deduction-amount { color: #dc2626; }
        .salary-table .total-row td {
          font-weight: 600;
          background: #f9fafb;
          font-size: 12px;
        }
        /* 實領薪資區 */
        .net-pay-section {
          margin: 8px 20px 12px;
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
          border-radius: 8px;
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: white;
        }
        .net-pay-label { font-size: 14px; }
        .net-pay-amount { font-size: 22px; font-weight: bold; }
        /* 頁尾 */
        .footer {
          padding: 10px 20px;
          background: #f8fafc;
          border-top: 1px solid #e5e7eb;
          font-size: 10px;
          color: #6b7280;
          text-align: center;
        }
        .confidential-notice {
          background: #fef3c7;
          color: #92400e;
          padding: 4px 10px;
          border-radius: 4px;
          margin-bottom: 6px;
          font-weight: 500;
          font-size: 10px;
          display: inline-block;
        }
        /* 列印樣式 */
        @media print {
          body { background: white; padding: 0; margin: 0; }
          .payslip-container { box-shadow: none; border-radius: 0; }
          .watermark { color: rgba(100, 116, 139, 0.06); }
        }
      </style>
    </head>
    <body>
      <div class="payslip-container">
        <!-- 浮水印 -->
        <div class="watermark">內部機密 僅限本人查閱</div>
        
        <div class="content">
          <!-- 標題區 -->
          <div class="header">
            <div class="header-left">
              <img src="${LOGO_BASE64}" alt="長福會" class="logo" />
              <div class="header-title">
                <h1>薪資條</h1>
                <p>${payslip.companyInfo.name}</p>
              </div>
            </div>
            <div class="period-badge">${payslip.period.monthName}</div>
          </div>

          <!-- 員工資訊區 -->
          <div class="employee-info">
            <div class="info-card">
              <h3>👤 員工資訊</h3>
              <div class="info-item"><span class="info-label">員工編號</span><span class="info-value">${payslip.employee.employeeId}</span></div>
              <div class="info-item"><span class="info-label">姓名</span><span class="info-value">${payslip.employee.name}</span></div>
              <div class="info-item"><span class="info-label">部門</span><span class="info-value">${payslip.employee.department || 'N/A'}</span></div>
              <div class="info-item"><span class="info-label">職位</span><span class="info-value">${payslip.employee.position || 'N/A'}</span></div>
            </div>
            <div class="info-card">
              <h3>⏰ 工時統計</h3>
              <div class="info-item"><span class="info-label">正常工時</span><span class="info-value">${payslip.workHours.regular} 小時</span></div>
              <div class="info-item"><span class="info-label">加班工時</span><span class="info-value">${payslip.workHours.overtime} 小時</span></div>
              <div class="info-item"><span class="info-label">總工時</span><span class="info-value">${payslip.workHours.total} 小時</span></div>
            </div>
          </div>

          <!-- 薪資明細區 -->
          <div class="salary-section">
            <!-- 收入項目 -->
            <div class="section-header income">💰 收入項目</div>
            <table class="salary-table">
              <tr>
                <td>基本薪資</td>
                <td class="income-amount">NT$ ${payslip.salary.basePay.toLocaleString()}</td>
              </tr>
              <tr>
                <td>加班費</td>
                <td class="income-amount">NT$ ${payslip.salary.overtimePay.toLocaleString()}</td>
              </tr>
              <tr class="total-row">
                <td>應發合計</td>
                <td class="income-amount">NT$ ${payslip.salary.grossPay.toLocaleString()}</td>
              </tr>
            </table>

            <!-- 扣除項目 -->
            <div class="section-header deduction" style="margin-top: 16px;">📉 扣除項目</div>
            <table class="salary-table">
              <tr>
                <td>勞工保險</td>
                <td class="deduction-amount">NT$ ${payslip.deductions.laborInsurance.toLocaleString()}</td>
              </tr>
              <tr>
                <td>健康保險</td>
                <td class="deduction-amount">NT$ ${payslip.deductions.healthInsurance.toLocaleString()}</td>
              </tr>
              <tr>
                <td>補充保費</td>
                <td class="deduction-amount">NT$ ${payslip.deductions.supplementaryInsurance.toLocaleString()}</td>
              </tr>
              <tr>
                <td>所得稅</td>
                <td class="deduction-amount">NT$ ${payslip.deductions.incomeTax.toLocaleString()}</td>
              </tr>
              <tr class="total-row">
                <td>扣除合計</td>
                <td class="deduction-amount">NT$ ${payslip.deductions.total.toLocaleString()}</td>
              </tr>
            </table>
          </div>

          <!-- 實領薪資區 -->
          <div class="net-pay-section">
            <span class="net-pay-label">實領薪資</span>
            <span class="net-pay-amount">NT$ ${payslip.netPay.toLocaleString()}</span>
          </div>

          <!-- 頁尾 -->
          <div class="footer">
            <div class="confidential-notice">
              🔒 本薪資條專供 ${payslip.employee.name} (${payslip.employee.employeeId}) 查閱，請妥善保管
            </div>
            <p>生成時間：${new Date(payslip.generatedAt).toLocaleString('zh-TW')}</p>
            <p style="margin-top: 4px;">${payslip.companyInfo.name} | 如有疑問請洽人事部門</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}
