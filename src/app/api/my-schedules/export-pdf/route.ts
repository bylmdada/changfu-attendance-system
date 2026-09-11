import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { formatShiftDisplay } from '@/lib/shift-display';

interface Schedule {
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime?: number;
  workHours?: number;
  expectedWorkHours?: number;
  specialLeaveHours?: number;
  compLeaveHours?: number;
  overtimeHours?: number;
  isNationalHoliday?: boolean;
  nationalHolidayName?: string | null;
  nationalHolidayHours?: number;
}

interface User {
    employeeId: number | string;
  name?: string;
  department?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isValidSchedule(value: unknown): value is Schedule {
    return isRecord(value)
        && typeof value.workDate === 'string'
        && typeof value.shiftType === 'string'
        && typeof value.startTime === 'string'
        && typeof value.endTime === 'string'
        && (value.breakTime === undefined || typeof value.breakTime === 'number')
        && (value.workHours === undefined || typeof value.workHours === 'number')
        && (value.expectedWorkHours === undefined || typeof value.expectedWorkHours === 'number')
        && (value.specialLeaveHours === undefined || typeof value.specialLeaveHours === 'number')
        && (value.compLeaveHours === undefined || typeof value.compLeaveHours === 'number')
        && (value.overtimeHours === undefined || typeof value.overtimeHours === 'number')
        && (value.isNationalHoliday === undefined || typeof value.isNationalHoliday === 'boolean')
        && (value.nationalHolidayName === undefined || value.nationalHolidayName === null || typeof value.nationalHolidayName === 'string')
        && (value.nationalHolidayHours === undefined || typeof value.nationalHolidayHours === 'number');
}

function isValidExportUser(value: unknown): value is User {
    return isRecord(value)
        && (typeof value.employeeId === 'number' || typeof value.employeeId === 'string')
        && (value.name === undefined || typeof value.name === 'string')
        && (value.department === undefined || typeof value.department === 'string');
}

function parseExportPayload(body: unknown): { year: number; month: number; schedules: Schedule[]; user: User } | null {
    if (!isRecord(body)) {
        return null;
    }

    const { year, month, schedules, user } = body;
    if (typeof year !== 'number' || typeof month !== 'number') {
        return null;
    }

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return null;
    }

    if (!Array.isArray(schedules) || !schedules.every(isValidSchedule) || !isValidExportUser(user)) {
        return null;
    }

    return {
        year,
        month,
        schedules,
        user,
    };
}

export async function POST(request: NextRequest) {
  try {
        const rateLimitResult = await checkRateLimit(request);
        if (!rateLimitResult.allowed) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }

        const csrfResult = await validateCSRF(request);
        if (!csrfResult.valid) {
            return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
        }

        const currentUser = await getUserFromRequest(request);
        if (!currentUser?.employeeId) {
            return NextResponse.json({ error: '未授權' }, { status: 401 });
        }

        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: '請提供有效的班表匯出資料' }, { status: 400 });
        }

        const payload = parseExportPayload(body);
        if (!payload) {
            return NextResponse.json({ error: '請提供有效的班表匯出資料' }, { status: 400 });
        }

        const employee = await prisma.employee.findUnique({
            where: { id: currentUser.employeeId },
            select: {
                employeeId: true,
                name: true,
                department: true,
            },
        });

        if (!employee) {
            return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
        }

        if (String(payload.user.employeeId) !== String(employee.employeeId)) {
            return NextResponse.json({ error: '只能匯出自己的班表' }, { status: 403 });
        }

        const exportUser: User = {
            employeeId: employee.employeeId,
            name: employee.name ?? payload.user.name,
            department: employee.department ?? payload.user.department,
        };

        const htmlContent = generateScheduleHTML(payload.year, payload.month, payload.schedules, exportUser);
    
    return new NextResponse(htmlContent, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
                'Content-Disposition': `inline; filename="schedule_${exportUser.employeeId}_${payload.year}${payload.month.toString().padStart(2, '0')}.html"`
      }
    });

  } catch (error) {
    console.error('班表匯出失敗:', error);
    return NextResponse.json(
            { error: '系統錯誤' },
            { status: 500 }
    );
  }
}

function generateScheduleHTML(year: number, month: number, schedules: Schedule[], user: User): string {
  const monthName = `${year}年${month.toString().padStart(2, '0')}月`;
  const totalWorkHours = sumHours(schedules, 'workHours');
  const totalExpectedWorkHours = Math.round(schedules.reduce((sum, schedule) => sum + getExpectedWorkHours(schedule), 0) * 100) / 100;
  const totalSpecialLeaveHours = sumHours(schedules, 'specialLeaveHours');
  const totalCompLeaveHours = sumHours(schedules, 'compLeaveHours');
  const totalOvertimeHours = sumHours(schedules, 'overtimeHours');
  const totalNationalHolidayHours = Math.round(schedules.reduce((sum, schedule) => sum + getNationalHolidayHours(schedule), 0) * 100) / 100;
  const totalAccountedHours = totalWorkHours + totalSpecialLeaveHours + totalCompLeaveHours + totalOvertimeHours;
  const actualWorkDays = schedules.filter(schedule => (schedule.workHours ?? 0) > 0).length;
  const nonWorkDays = schedules.filter(schedule => (schedule.workHours ?? 0) <= 0).length;
  const shiftDistribution = buildShiftDistribution(schedules);
  
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

        .shift-distribution {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 15px;
        }

        .shift-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border: 1px solid #dbeafe;
            background: #eff6ff;
            color: #1e3a8a;
            border-radius: 999px;
            padding: 6px 10px;
            font-size: 12px;
            font-weight: 600;
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
                <span class="info-value">${escapeHtml(user?.employeeId || '未知')}</span>
            </div>
            <div class="info-row">
                <span class="info-label">姓名：</span>
                <span class="info-value">${escapeHtml(user?.name || '未知員工')}</span>
            </div>
            <div class="info-row">
                <span class="info-label">部門：</span>
                <span class="info-value">${escapeHtml(user?.department || '未知部門')}</span>
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
                    <th>應上工時</th>
                    <th>工時</th>
                    <th>特休</th>
                    <th>補休</th>
                    <th>加班</th>
                    <th>國定假日</th>
                </tr>
            </thead>
            <tbody>
                ${schedules.length === 0 ? 
                    '<tr><td colspan="12" style="padding: 40px; color: #6b7280;">本月暫無班表記錄</td></tr>' :
                    schedules.map(schedule => {
                        const date = new Date(schedule.workDate);
                        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                        const weekday = weekdays[date.getDay()];
                        
                        return `
                        <tr class="shift-${escapeHtml(schedule.shiftType)}">
                        <td><strong>${escapeHtml(schedule.workDate)}</strong></td>
                            <td>星期${weekday}</td>
                            <td>
                                <span class="shift-badge shift-${escapeHtml(schedule.shiftType)}">
                                    ${escapeHtml(formatShiftDisplay({
                                     shiftType: schedule.shiftType,
                                     startTime: schedule.startTime,
                                     endTime: schedule.endTime,
                                    }))}
                                </span>
                            </td>
                            <td>${escapeHtml(schedule.startTime || '-')}</td>
                            <td>${escapeHtml(schedule.endTime || '-')}</td>
                            <td>${schedule.breakTime ? schedule.breakTime + '分鐘' : '-'}</td>
                            <td>${formatHours(getExpectedWorkHours(schedule))}</td>
                            <td>${formatHours(schedule.workHours)}</td>
                            <td>${formatHours(schedule.specialLeaveHours)}</td>
                            <td>${formatHours(schedule.compLeaveHours)}</td>
                            <td>${formatHours(schedule.overtimeHours)}</td>
                            <td>${formatHours(getNationalHolidayHours(schedule))}</td>
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
                    <div class="summary-label">應上工時</div>
                    <div class="summary-value">${formatHours(totalExpectedWorkHours)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">總工時</div>
                    <div class="summary-value">${formatHours(totalWorkHours)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">特休時數</div>
                    <div class="summary-value">${formatHours(totalSpecialLeaveHours)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">補休時數</div>
                    <div class="summary-value">${formatHours(totalCompLeaveHours)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">加班時數</div>
                    <div class="summary-value">${formatHours(totalOvertimeHours)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">國定假日時數</div>
                    <div class="summary-value">${formatHours(totalNationalHolidayHours)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">合計時數</div>
                    <div class="summary-value">${formatHours(totalAccountedHours)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">排班天數</div>
                    <div class="summary-value">${schedules.length}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">實際出勤天數</div>
                    <div class="summary-value">${actualWorkDays}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">非出勤天數</div>
                    <div class="summary-value">${nonWorkDays}</div>
                </div>
            </div>
            <h3 style="margin-top: 20px;">📋 班別分布</h3>
            <div class="shift-distribution">
                ${shiftDistribution.map(stat => `
                    <span class="shift-chip">${escapeHtml(stat.label)}：${stat.count}天</span>
                `).join('') || '<span class="shift-chip">本月無排班資料</span>'}
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

function sumHours(schedules: Schedule[], key: 'workHours' | 'specialLeaveHours' | 'compLeaveHours' | 'overtimeHours') {
  return Math.round(schedules.reduce((sum, schedule) => sum + (schedule[key] ?? 0), 0) * 100) / 100;
}

function getExpectedWorkHours(schedule: Schedule) {
  return schedule.expectedWorkHours ?? Math.round(
    ((schedule.workHours ?? 0) + (schedule.specialLeaveHours ?? 0) + (schedule.compLeaveHours ?? 0)) * 100
  ) / 100;
}

function getNationalHolidayHours(schedule: Schedule) {
  return schedule.nationalHolidayHours ?? (schedule.isNationalHoliday ? Math.round((schedule.workHours ?? 0) * 100) / 100 : 0);
}

function formatHours(hours: number | undefined) {
  const value = hours ?? 0;
  if (!Number.isFinite(value) || value <= 0) {
    return '-';
  }

  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}小時`;
}

function buildShiftDistribution(schedules: Schedule[]) {
  const stats = new Map<string, { shiftType: string; label: string; count: number; firstSeenIndex: number }>();

  schedules.forEach((schedule, index) => {
    const shiftType = schedule.shiftType || '未設定';
    const current = stats.get(shiftType) ?? {
      shiftType,
      label: formatShiftDisplay({
        shiftType,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      }),
      count: 0,
      firstSeenIndex: index,
    };

    current.count += 1;
    stats.set(shiftType, current);
  });

  return Array.from(stats.values()).sort((a, b) => a.firstSeenIndex - b.firstSeenIndex || a.shiftType.localeCompare(b.shiftType));
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
