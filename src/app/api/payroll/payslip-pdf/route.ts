import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

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
    const user = getUserFromRequest(request);
    
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

    // 返回HTML內容供前端生成PDF
    return NextResponse.json({
      success: true,
      htmlContent,
      payslipData,
      fileName: `薪資條_${payslipData.employee.name}_${payslipData.period.monthName}.pdf`
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
      <title>薪資條 - ${payslip.employee.name}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body { 
          font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif; 
          margin: 0;
          padding: 20px;
          color: #333;
          line-height: 1.6;
        }
        
        .payslip-container {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .header { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-align: center; 
          padding: 30px 20px;
          position: relative;
        }
        
        .header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255,255,255,0.1);
        }
        
        .header-content {
          position: relative;
          z-index: 1;
        }
        
        .company-name {
          font-size: 28px;
          font-weight: bold;
          margin-bottom: 8px;
        }
        
        .document-title {
          font-size: 22px;
          margin-bottom: 8px;
        }
        
        .period {
          font-size: 18px;
          opacity: 0.9;
        }
        
        .content {
          padding: 30px;
        }
        
        .info-section { 
          margin-bottom: 25px;
          background: #f8f9fa;
          border-radius: 8px;
          padding: 20px;
        }
        
        .section-title {
          font-size: 18px;
          font-weight: bold;
          color: #495057;
          margin-bottom: 15px;
          padding-bottom: 8px;
          border-bottom: 2px solid #e9ecef;
        }
        
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        
        .info-row { 
          display: flex; 
          justify-content: space-between; 
          padding: 8px 0;
          border-bottom: 1px solid #e9ecef;
        }
        
        .info-row:last-child {
          border-bottom: none;
        }
        
        .total-row {
          background: #e3f2fd;
          margin: 8px -20px;
          padding: 12px 20px;
          border-radius: 4px;
          font-weight: bold;
        }
        
        .deductions-section {
          background: #fff3e0;
          border-left: 4px solid #ff9800;
        }
        
        .final-section {
          background: #e8f5e8;
          border-left: 4px solid #4caf50;
        }
        
        .final-total {
          background: #c8e6c9;
          margin: 8px -20px;
          padding: 15px 20px;
          border-radius: 4px;
          font-weight: bold;
          font-size: 18px;
        }
        
        .sub-note {
          font-size: 12px;
          color: #666;
          font-style: italic;
        }
        
        .negative {
          color: #d32f2f;
        }
        
        .final-amount {
          color: #2e7d32;
          font-weight: bold;
          font-size: 20px;
        }
        
        .label {
          font-weight: 500;
          color: #6c757d;
        }
        
        .value {
          font-weight: 600;
          color: #495057;
        }
        
        .amount { 
          font-weight: bold; 
          color: #28a745;
        }
        
        .deduction {
          color: #dc3545;
        }
        
        .total-section {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border-radius: 8px;
          padding: 20px;
          margin-top: 20px;
        }
        
        .total-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 20px;
          font-weight: bold;
        }
        
        .footer {
          margin-top: 30px;
          text-align: center;
          padding: 20px;
          background: #f8f9fa;
          border-radius: 8px;
          font-size: 12px;
          color: #6c757d;
        }
        
        .footer-info {
          margin-bottom: 8px;
        }
        
        @media print {
          body { 
            margin: 0; 
            padding: 0;
          }
          .payslip-container {
            box-shadow: none;
            border-radius: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="payslip-container">
        <div class="header">
          <div class="header-content">
            <div class="company-name">${payslip.companyInfo.name}</div>
            <div class="document-title">員工薪資條</div>
            <div class="period">${payslip.period.monthName}</div>
          </div>
        </div>

        <div class="content">
          <div class="info-section">
            <div class="section-title">員工資訊</div>
            <div class="info-grid">
              <div class="info-row">
                <span class="label">員工編號:</span>
                <span class="value">${payslip.employee.employeeId}</span>
              </div>
              <div class="info-row">
                <span class="label">姓名:</span>
                <span class="value">${payslip.employee.name}</span>
              </div>
              <div class="info-row">
                <span class="label">部門:</span>
                <span class="value">${payslip.employee.department || 'N/A'}</span>
              </div>
              <div class="info-row">
                <span class="label">職位:</span>
                <span class="value">${payslip.employee.position || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div class="info-section">
            <div class="section-title">工時計算</div>
            <div class="info-row">
              <span class="label">正常工時:</span>
              <span class="value">${payslip.workHours.regular} 小時</span>
            </div>
            <div class="info-row">
              <span class="label">加班工時:</span>
              <span class="value">${payslip.workHours.overtime} 小時</span>
            </div>
          </div>

          <div class="info-section">
            <div class="section-title">薪資組成</div>
            <div class="info-row">
              <span class="label">1. 基本薪資支付:</span>
              <span class="value amount">NT$ ${payslip.salary.basePay.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">2. 加班費計算:</span>
              <span class="value amount">NT$ ${payslip.salary.overtimePay.toLocaleString()}</span>
            </div>
            <div class="info-row total-row">
              <span class="label">3. 總薪資(稅前):</span>
              <span class="value amount">NT$ ${payslip.salary.grossPay.toLocaleString()}</span>
            </div>
          </div>

          <div class="info-section deductions-section">
            <div class="section-title">扣除項目</div>
            <div class="info-row">
              <span class="label">1. 勞保費 (員工負擔20%):</span>
              <span class="value amount negative">-NT$ ${payslip.deductions.laborInsurance.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">2. 健保費 (員工負擔30%):</span>
              <span class="value amount negative">-NT$ ${payslip.deductions.healthInsurance.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">3. 所得稅預扣 (約5%):</span>
              <span class="value amount negative">-NT$ ${payslip.deductions.incomeTax.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">4. 其他扣除:</span>
              <span class="value amount negative">-NT$ ${Math.max(0, payslip.deductions.total - payslip.deductions.laborInsurance - payslip.deductions.healthInsurance - payslip.deductions.incomeTax).toLocaleString()}</span>
            </div>
            <div class="info-row sub-note">
              <span class="label">(二代健保補充保費、工會費等)</span>
              <span class="value"></span>
            </div>
          </div>

          <div class="info-section final-section">
            <div class="section-title">最終計算</div>
            <div class="info-row">
              <span class="label">總薪資:</span>
              <span class="value amount">NT$ ${payslip.salary.grossPay.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">總扣除額:</span>
              <span class="value amount negative">-NT$ ${payslip.deductions.total.toLocaleString()}</span>
            </div>
            <div class="info-row final-total">
              <span class="label">實領薪資:</span>
              <span class="value amount final-amount">NT$ ${payslip.netPay.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">總薪資:</span>
              <span class="value amount">NT$ ${payslip.salary.grossPay.toLocaleString()}</span>
            </div>
          </div>

          <div class="info-section">
            <div class="section-title">扣除項目</div>
            <div class="info-row">
              <span class="label">勞工保險:</span>
              <span class="value deduction">NT$ ${payslip.deductions.laborInsurance.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">健康保險:</span>
              <span class="value deduction">NT$ ${payslip.deductions.healthInsurance.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">補充保費:</span>
              <span class="value deduction">NT$ ${payslip.deductions.supplementaryInsurance.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">所得稅:</span>
              <span class="value deduction">NT$ ${payslip.deductions.incomeTax.toLocaleString()}</span>
            </div>
            <div class="info-row">
              <span class="label">總扣除額:</span>
              <span class="value deduction">NT$ ${payslip.deductions.total.toLocaleString()}</span>
            </div>
          </div>

          <div class="total-section">
            <div class="total-row">
              <span>實領薪資:</span>
              <span>NT$ ${payslip.netPay.toLocaleString()}</span>
            </div>
          </div>

          <div class="footer">
            <div class="footer-info">生成時間: ${new Date(payslip.generatedAt).toLocaleString()}</div>
            <div class="footer-info">${payslip.companyInfo.name}</div>
            <div style="margin-top: 10px; font-size: 10px; color: #adb5bd;">
              此薪資條由系統自動生成，如有疑問請聯繫人事部門
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}
