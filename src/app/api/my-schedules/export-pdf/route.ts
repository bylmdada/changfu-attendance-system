import { NextRequest, NextResponse } from 'next/server';

interface Schedule {
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime?: number;
}

interface User {
  employeeId: number;
  name?: string;
  department?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { year, month, schedules, user }: {
      year: number;
      month: number;
      schedules: Schedule[];
      user: User;
    } = await request.json();

    // 生成HTML內容用於PDF轉換
    const htmlContent = generateScheduleHTML(year, month, schedules, user);
    
    // 由於沒有安裝PDF生成庫，我們返回HTML格式供瀏覽器打印
    // 在生產環境中，建議使用 puppeteer 或 jsPDF 等庫
    
    return new NextResponse(htmlContent, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="schedule_${user?.employeeId}_${year}${month.toString().padStart(2, '0')}.html"`
      }
    });

  } catch (error) {
    console.error('班表匯出失敗:', error);
    return NextResponse.json(
      { error: '班表匯出失敗' },
      { status: 500 }
    );
  }
}

function generateScheduleHTML(year: number, month: number, schedules: Schedule[], user: User): string {
  const monthName = `${year}年${month.toString().padStart(2, '0')}月`;
  
  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>個人班表 - ${monthName}</title>
    <style>
        @media print {
            @page {
                margin: 1cm;
                size: A4;
            }
            body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .no-print {
                display: none;
            }
        }
        
        body { 
            font-family: 'Microsoft JhengHei', '微軟正黑體', Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f9f9f9;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .header { 
            text-align: center; 
            margin-bottom: 30px;
            border-bottom: 2px solid #4F46E5;
            padding-bottom: 20px;
        }
        
        .header h1 {
            color: #4F46E5;
            margin: 0 0 10px 0;
            font-size: 28px;
        }
        
        .header h2 {
            color: #666;
            margin: 0;
            font-size: 20px;
            font-weight: normal;
        }
        
        .info { 
            margin-bottom: 30px;
            background-color: #f8f9ff;
            padding: 20px;
            border-radius: 6px;
            border-left: 4px solid #4F46E5;
        }
        
        .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        
        .info-row:last-child {
            margin-bottom: 0;
        }
        
        .info-label {
            font-weight: bold;
            color: #374151;
            min-width: 100px;
        }
        
        .info-value {
            color: #4F46E5;
            font-weight: 600;
        }

        table { 
            width: 100%; 
            border-collapse: collapse;
            margin-bottom: 30px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        th, td { 
            border: 1px solid #e5e7eb; 
            padding: 12px 8px; 
            text-align: center;
            vertical-align: middle;
        }
        
        th { 
            background-color: #4F46E5; 
            color: white;
            font-weight: bold;
            font-size: 14px;
        }
        
        tbody tr:nth-child(even) { 
            background-color: #f8f9ff; 
        }
        
        tbody tr:hover {
            background-color: #e0e7ff;
        }
        
        .shift-A { background-color: #dbeafe !important; color: #1e40af; }
        .shift-B { background-color: #dcfce7 !important; color: #166534; }
        .shift-C { background-color: #f3e8ff !important; color: #7c3aed; }
        .shift-NH { background-color: #e0e7ff !important; color: #3730a3; }
        .shift-RD, .shift-rd { background-color: #f3f4f6 !important; color: #6b7280; }
        .shift-OFF { background-color: #fef2f2 !important; color: #dc2626; }
        .shift-FDL { background-color: #fef3c7 !important; color: #d97706; }
        
        .shift-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
            min-width: 50px;
        }
        
        .summary {
            background-color: #f8f9ff;
            padding: 20px;
            border-radius: 6px;
            margin-top: 20px;
            border-left: 4px solid #10b981;
        }
        
        .summary h3 {
            margin: 0 0 15px 0;
            color: #374151;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }
        
        .summary-item {
            text-align: center;
            background-color: white;
            padding: 10px;
            border-radius: 4px;
        }
        
        .summary-label {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 5px;
        }
        
        .summary-value {
            font-size: 18px;
            font-weight: bold;
            color: #1f2937;
        }
        
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            font-size: 12px;
        }
        
        .print-button {
            background-color: #4F46E5;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            margin-bottom: 20px;
        }
        
        .print-button:hover {
            background-color: #4338ca;
        }
    </style>
    <script>
        function printPage() {
            window.print();
        }
    </script>
</head>
<body>
    <div class="container">
        <button class="print-button no-print" onclick="printPage()">🖨️ 列印班表</button>
        
        <div class="header">
            <h1>📋 個人班表</h1>
            <h2>${monthName}</h2>
        </div>
        
        <div class="info">
            <div class="info-row">
                <span class="info-label">員工編號：</span>
                <span class="info-value">${user?.employeeId || '未知'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">姓名：</span>
                <span class="info-value">${user?.name || '未知員工'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">部門：</span>
                <span class="info-value">${user?.department || '未知部門'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">查詢月份：</span>
                <span class="info-value">${monthName}</span>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th>日期</th>
                    <th>星期</th>
                    <th>班次</th>
                    <th>開始時間</th>
                    <th>結束時間</th>
                    <th>休息時間</th>
                </tr>
            </thead>
            <tbody>
                ${schedules.length === 0 ? 
                    '<tr><td colspan="6" style="padding: 40px; color: #6b7280;">本月暫無班表記錄</td></tr>' :
                    schedules.map(schedule => {
                        const date = new Date(schedule.workDate);
                        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                        const weekday = weekdays[date.getDay()];
                        
                        return `
                        <tr class="shift-${schedule.shiftType}">
                            <td><strong>${schedule.workDate}</strong></td>
                            <td>星期${weekday}</td>
                            <td>
                                <span class="shift-badge shift-${schedule.shiftType}">
                                    ${schedule.shiftType}班
                                </span>
                            </td>
                            <td>${schedule.startTime || '-'}</td>
                            <td>${schedule.endTime || '-'}</td>
                            <td>${schedule.breakTime ? schedule.breakTime + '分鐘' : '-'}</td>
                        </tr>
                        `;
                    }).join('')
                }
            </tbody>
        </table>
        
        ${schedules.length > 0 ? `
        <div class="summary">
            <h3>📊 本月統計</h3>
            <div class="summary-grid">
                <div class="summary-item">
                    <div class="summary-label">總工作天數</div>
                    <div class="summary-value">${schedules.filter(s => !['RD', 'rd', 'OFF', 'FDL'].includes(s.shiftType)).length}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">A班次數</div>
                    <div class="summary-value">${schedules.filter(s => s.shiftType === 'A').length}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">B班次數</div>
                    <div class="summary-value">${schedules.filter(s => s.shiftType === 'B').length}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">C班次數</div>
                    <div class="summary-value">${schedules.filter(s => s.shiftType === 'C').length}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">休息天數</div>
                    <div class="summary-value">${schedules.filter(s => ['RD', 'rd', 'OFF'].includes(s.shiftType)).length}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">請假天數</div>
                    <div class="summary-value">${schedules.filter(s => s.shiftType === 'FDL').length}</div>
                </div>
            </div>
        </div>
        ` : ''}
        
        <div class="footer">
            <p>📅 生成時間：${new Date().toLocaleString('zh-TW')}</p>
            <p>💼 長福會考勤系統 - 個人班表查詢</p>
        </div>
    </div>
</body>
</html>
  `;
}
