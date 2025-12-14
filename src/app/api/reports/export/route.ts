import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting for export operations
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以匯出報表
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const department = searchParams.get('department');

    // 建立篩選條件
    const where: {
      payYear?: number;
      payMonth?: number;
      employee?: {
        department?: string;
      };
    } = {};

    if (year) {
      where.payYear = parseInt(year);
    }

    if (month) {
      where.payMonth = parseInt(month);
    }

    if (department) {
      where.employee = { department };
    }

    // 獲取薪資記錄
    const payrollRecords = await prisma.payrollRecord.findMany({
      where,
      select: {
        id: true,
        payYear: true,
        payMonth: true,
        regularHours: true,
        overtimeHours: true,
        basePay: true,
        overtimePay: true,
        grossPay: true,
        laborInsurance: true,
        healthInsurance: true,
        supplementaryInsurance: true,
        incomeTax: true,
        totalDeductions: true,
        netPay: true,
        createdAt: true,
        employee: {
          select: {
            employeeId: true,
            name: true,
            department: true,
            position: true,
            baseSalary: true,
            hourlyRate: true,
            hireDate: true
          }
        }
      },
      orderBy: [
        { payYear: 'desc' },
        { payMonth: 'desc' },
        { employee: { name: 'asc' } }
      ]
    });

    if (payrollRecords.length === 0) {
      return NextResponse.json({ error: '沒有找到符合條件的薪資記錄' }, { status: 404 });
    }

    // 生成統計摘要
    const totalEmployees = payrollRecords.length;
    const totalGrossPay = payrollRecords.reduce((sum, record) => sum + record.grossPay, 0);
    const totalNetPay = payrollRecords.reduce((sum, record) => sum + record.netPay, 0);
    const totalDeductions = totalGrossPay - totalNetPay;
    const totalOvertimeHours = payrollRecords.reduce((sum, record) => sum + record.overtimeHours, 0);

    // 生成HTML內容用於PDF轉換
    const htmlContent = generatePayrollHTML(payrollRecords, {
      year,
      month,
      department,
      totalEmployees,
      totalGrossPay,
      totalNetPay,
      totalDeductions,
      totalOvertimeHours
    });

    const filename = `薪資報表_${year || '全部'}年${month ? `${month}月` : ''}_${new Date().toISOString().split('T')[0]}.html`;

    return new NextResponse(htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error('匯出報表失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

function generatePayrollHTML(payrollRecords: Array<{
  id: number;
  payYear: number;
  payMonth: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  grossPay: number;
  netPay: number;
  createdAt: Date;
  employee: {
    employeeId: string;
    name: string;
    department: string | null;
    position: string | null;
    baseSalary: number;
    hourlyRate: number;
    hireDate: Date;
  };
}>, summary: {
  year: string | null;
  month: string | null;
  department: string | null;
  totalEmployees: number;
  totalGrossPay: number;
  totalNetPay: number;
  totalDeductions: number;
  totalOvertimeHours: number;
}) {
  const title = `薪資報表 - ${summary.year || '全部'}年${summary.month ? `${summary.month}月` : ''}`;
  const exportDate = new Date().toLocaleDateString('zh-TW');

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: 'Microsoft JhengHei', Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: white;
            color: #333;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #2563eb;
            padding-bottom: 20px;
        }
        .header h1 {
            margin: 0;
            color: #2563eb;
            font-size: 28px;
        }
        .header p {
            margin: 5px 0;
            color: #666;
            font-size: 14px;
        }
        .summary {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .summary h2 {
            margin: 0 0 15px 0;
            color: #1e40af;
            font-size: 20px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        .summary-item {
            background: white;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #2563eb;
        }
        .summary-item .label {
            font-size: 14px;
            color: #64748b;
            margin-bottom: 5px;
        }
        .summary-item .value {
            font-size: 18px;
            font-weight: bold;
            color: #1e293b;
        }
        .payroll-details {
            margin-top: 30px;
        }
        .payroll-details h2 {
            color: #1e40af;
            font-size: 24px;
            margin-bottom: 20px;
            border-bottom: 2px solid #2563eb;
            padding-bottom: 10px;
        }
        .employee-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            margin-bottom: 30px;
            padding: 20px;
            page-break-inside: avoid;
        }
        .employee-header {
            background: #f8fafc;
            margin: -20px -20px 20px -20px;
            padding: 15px 20px;
            border-bottom: 1px solid #e2e8f0;
            border-radius: 8px 8px 0 0;
        }
        .employee-header h3 {
            margin: 0 0 5px 0;
            color: #1e40af;
            font-size: 20px;
        }
        .employee-header p {
            margin: 2px 0;
            color: #64748b;
            font-size: 14px;
        }
        .salary-breakdown {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        .section {
            background: #fafbfc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 15px;
        }
        .section h4 {
            margin: 0 0 12px 0;
            color: #1e40af;
            font-size: 16px;
            font-weight: bold;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 8px;
        }
        .item-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 0;
            border-bottom: 1px solid #f1f5f9;
        }
        .item-row:last-child {
            border-bottom: none;
        }
        .item-row.sub-calc {
            font-size: 12px;
            color: #64748b;
            font-style: italic;
        }
        .item-row.total {
            font-weight: bold;
            background: #f1f5f9;
            margin: 8px -15px;
            padding: 8px 15px;
            border-radius: 4px;
        }
        .item-row.final-total {
            font-weight: bold;
            background: #dbeafe;
            color: #1e40af;
            margin: 8px -15px;
            padding: 10px 15px;
            border-radius: 4px;
            font-size: 16px;
        }
        .section.final-calc {
            background: #f0f9ff;
            border: 2px solid #2563eb;
        }
        @media (max-width: 768px) {
            .salary-breakdown {
                grid-template-columns: 1fr;
                gap: 15px;
            }
        }
        @media print {
            .employee-card {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .salary-breakdown {
                grid-template-columns: 1fr;
                gap: 10px;
            }
        }
        .table-container {
            overflow-x: auto;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        th {
            background: #f1f5f9;
            color: #334155;
            font-weight: bold;
            padding: 12px 8px;
            text-align: left;
            border-bottom: 2px solid #e2e8f0;
        }
        td {
            padding: 10px 8px;
            border-bottom: 1px solid #f1f5f9;
        }
        tr:hover {
            background: #f8fafc;
        }
        .number {
            text-align: right;
        }
        .footer {
            margin-top: 30px;
            text-align: center;
            color: #64748b;
            font-size: 12px;
            border-top: 1px solid #e2e8f0;
            padding-top: 20px;
        }
        @media print {
            body { margin: 0; padding: 15px; }
            .header h1 { font-size: 24px; }
            .summary-grid { grid-template-columns: repeat(3, 1fr); }
            table { font-size: 10px; }
            th, td { padding: 6px 4px; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${title}</h1>
        <p>匯出日期：${exportDate}</p>
        ${summary.department ? `<p>部門：${summary.department}</p>` : ''}
    </div>

    <div class="summary">
        <h2>統計摘要</h2>
        <div class="summary-grid">
            <div class="summary-item">
                <div class="label">員工總數</div>
                <div class="value">${summary.totalEmployees} 人</div>
            </div>
            <div class="summary-item">
                <div class="label">總薪資</div>
                <div class="value">NT$ ${summary.totalGrossPay.toLocaleString()}</div>
            </div>
            <div class="summary-item">
                <div class="label">實領總額</div>
                <div class="value">NT$ ${summary.totalNetPay.toLocaleString()}</div>
            </div>
            <div class="summary-item">
                <div class="label">總扣除額</div>
                <div class="value">NT$ ${summary.totalDeductions.toLocaleString()}</div>
            </div>
            <div class="summary-item">
                <div class="label">總加班時數</div>
                <div class="value">${summary.totalOvertimeHours} 小時</div>
            </div>
            <div class="summary-item">
                <div class="label">平均薪資</div>
                <div class="value">NT$ ${Math.round(summary.totalGrossPay / summary.totalEmployees).toLocaleString()}</div>
            </div>
        </div>
    </div>

    <div class="payroll-details">
        <h2>詳細薪資報表</h2>
        ${payrollRecords.map(record => {
          // 使用資料庫中的實際扣除項目數據
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recordData = record as any;
          const laborInsurance = recordData.laborInsurance || 0;
          const healthInsurance = recordData.healthInsurance || 0;
          const supplementaryInsurance = recordData.supplementaryInsurance || 0;
          const incomeTax = recordData.incomeTax || 0;
          const totalDeductions = recordData.totalDeductions || (record.grossPay - record.netPay);
          const otherDeductions = Math.max(0, totalDeductions - laborInsurance - healthInsurance - supplementaryInsurance - incomeTax);
          
          return `
            <div class="employee-card">
                <div class="employee-header">
                    <h3>${record.employee.name} (員編: ${record.employee.employeeId})</h3>
                    <p>部門: ${record.employee.department || '-'} | 職位: ${record.employee.position || '-'}</p>
                    <p>薪資期間: ${record.payYear}年${record.payMonth}月</p>
                </div>
                
                <div class="salary-breakdown">
                    <div class="section">
                        <h4>工時計算</h4>
                        <div class="item-row">
                            <span>正常工時:</span>
                            <span>${record.regularHours} 小時</span>
                        </div>
                        <div class="item-row">
                            <span>加班工時:</span>
                            <span>${record.overtimeHours} 小時</span>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h4>薪資組成</h4>
                        <div class="item-row">
                            <span>1. 基本薪資支付:</span>
                            <span>NT$ ${record.basePay.toLocaleString()}</span>
                        </div>
                        <div class="item-row">
                            <span>2. 加班費計算:</span>
                            <span>NT$ ${record.overtimePay.toLocaleString()}</span>
                        </div>
                        <div class="item-row sub-calc">
                            <span>(${record.employee.hourlyRate} 元/時 × ${record.overtimeHours} 小時 × 1.34倍)</span>
                            <span></span>
                        </div>
                        <div class="item-row total">
                            <span>3. 總薪資(稅前):</span>
                            <span>NT$ ${record.grossPay.toLocaleString()}</span>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h4>扣除項目</h4>
                        <div class="item-row">
                            <span>1. 勞工保險 (員工負擔20%):</span>
                            <span>NT$ ${laborInsurance.toLocaleString()}</span>
                        </div>
                        <div class="item-row">
                            <span>2. 健康保險 (員工負擔30%):</span>
                            <span>NT$ ${healthInsurance.toLocaleString()}</span>
                        </div>
                        <div class="item-row">
                            <span>3. 補充保費 (二代健保):</span>
                            <span>NT$ ${supplementaryInsurance.toLocaleString()}</span>
                        </div>
                        <div class="item-row">
                            <span>4. 所得稅預扣 (約5%):</span>
                            <span>NT$ ${incomeTax.toLocaleString()}</span>
                        </div>
                        <div class="item-row">
                            <span>5. 其他扣除:</span>
                            <span>NT$ ${Math.max(0, otherDeductions).toLocaleString()}</span>
                        </div>
                        <div class="item-row sub-calc">
                            <span>(工會費、團保費等)</span>
                            <span></span>
                        </div>
                    </div>
                    
                    <div class="section final-calc">
                        <h4>最終計算</h4>
                        <div class="item-row">
                            <span>總薪資:</span>
                            <span>NT$ ${record.grossPay.toLocaleString()}</span>
                        </div>
                        <div class="item-row">
                            <span>總扣除額:</span>
                            <span>NT$ ${(record.grossPay - record.netPay).toLocaleString()}</span>
                        </div>
                        <div class="item-row final-total">
                            <span>實領薪資:</span>
                            <span>NT$ ${record.netPay.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>
          `;
        }).join('')}
    </div>

    <div class="footer">
        <p>長福會考勤系統 - 薪資報表</p>
        <p>此報表包含 ${summary.totalEmployees} 名員工的薪資資料</p>
        <p>列印提示：使用瀏覽器的列印功能（Ctrl+P）將此頁面儲存為PDF</p>
    </div>

    <script>
        // 自動觸發列印對話框
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 1000);
        };
    </script>
</body>
</html>
  `;
}
