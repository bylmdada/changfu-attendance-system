/**
 * 離職證明預覽 API
 * GET: 生成離職證明 HTML 預覽
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { parseIntegerQueryParam } from '@/lib/query-params';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function parseRecordId(value: string): number | null {
  const parsedId = parseIntegerQueryParam(value, { min: 1 });
  return parsedId.isValid ? parsedId.value : null;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員/HR 可以預覽離職證明
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限操作' }, { status: 403 });
    }

    const { id } = await params;
    const recordId = parseRecordId(id);

    if (recordId === null) {
      return NextResponse.json({ error: '離職申請ID格式無效' }, { status: 400 });
    }

    // 取得離職記錄
    const record = await prisma.resignationRecord.findUnique({
      where: { id: recordId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true,
            hireDate: true
          }
        }
      }
    });

    if (!record) {
      return NextResponse.json({ error: '找不到離職記錄' }, { status: 404 });
    }

    // 生成 HTML 預覽
    const employee = record.employee;
    const hireDate = new Date(employee.hireDate);
    const leaveDate = record.actualDate ? new Date(record.actualDate) : new Date(record.expectedDate);
    
    const hireDateStr = `${hireDate.getFullYear()}年${hireDate.getMonth() + 1}月${hireDate.getDate()}日`;
    const leaveDateStr = `${leaveDate.getFullYear()}年${leaveDate.getMonth() + 1}月${leaveDate.getDate()}日`;
    
    // 計算任職年資
    const years = leaveDate.getFullYear() - hireDate.getFullYear();
    const months = leaveDate.getMonth() - hireDate.getMonth();
    const totalMonths = years * 12 + months;
    const tenureYears = Math.floor(totalMonths / 12);
    const tenureMonths = totalMonths % 12;
    const tenureStr = tenureYears > 0 
      ? `${tenureYears}年${tenureMonths}個月`
      : `${tenureMonths}個月`;

    const reasonTypeMap: Record<string, string> = {
      'VOLUNTARY': '個人因素自願離職',
      'LAYOFF': '公司資遣',
      'RETIREMENT': '屆齡退休',
      'OTHER': '其他原因'
    };

    const today = new Date();
    const todayStr = `中華民國 ${today.getFullYear() - 1911} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;
    const companyName = '社團法人宜蘭縣長期照護及社會福祉推廣協會';

    const html = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>離職證明書 - ${employee.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Microsoft JhengHei', '微軟正黑體', sans-serif;
      background: #f5f5f5;
      padding: 40px;
    }
    .certificate {
      max-width: 700px;
      margin: 0 auto;
      background: white;
      padding: 60px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      border: 1px solid #e0e0e0;
    }
    .title {
      text-align: center;
      font-size: 32px;
      font-weight: bold;
      letter-spacing: 12px;
      margin-bottom: 50px;
      color: #333;
    }
    .content {
      line-height: 2.2;
      font-size: 16px;
      color: #333;
    }
    .content p {
      margin-bottom: 8px;
    }
    .highlight {
      font-weight: bold;
      color: #000;
    }
    .section {
      margin: 30px 0;
    }
    .row {
      display: flex;
    }
    .label {
      width: 120px;
      color: #666;
    }
    .value {
      flex: 1;
      font-weight: 500;
    }
    .footer {
      margin-top: 60px;
      text-align: right;
      line-height: 2;
    }
    .company-seal {
      margin-top: 20px;
      padding: 10px 20px;
      border: 2px dashed #ccc;
      display: inline-block;
      color: #999;
      font-size: 14px;
    }
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 80px;
      color: rgba(0,0,0,0.03);
      pointer-events: none;
      z-index: -1;
    }
    @media print {
      body { background: white; padding: 0; }
      .certificate { box-shadow: none; border: none; }
      .watermark { display: none; }
    }
  </style>
</head>
<body>
  <div class="watermark">${record.status === 'COMPLETED' ? '' : '預 覽'}</div>
  <div class="certificate">
    <h1 class="title">離 職 證 明 書</h1>
    
    <div class="content">
      <p>茲證明 <span class="highlight">${employee.name}</span> 先生/女士</p>
      
      <p style="margin: 20px 0;">身分證字號：＿＿＿＿＿＿＿＿＿＿</p>
      
      <p>於本單位服務期間如下：</p>
      
      <div class="section">
        <div class="row"><span class="label">到職日期：</span><span class="value">${hireDateStr}</span></div>
        <div class="row"><span class="label">離職日期：</span><span class="value">${leaveDateStr}</span></div>
        <div class="row"><span class="label">任職年資：</span><span class="value">${tenureStr}</span></div>
      </div>
      
      <div class="section">
        <div class="row"><span class="label">任職部門：</span><span class="value">${employee.department || '未指定'}</span></div>
        <div class="row"><span class="label">擔任職位：</span><span class="value">${employee.position || '未指定'}</span></div>
      </div>
      
      <div class="section">
        <div class="row"><span class="label">離職原因：</span><span class="value">${reasonTypeMap[record.reasonType] || record.reasonType}</span></div>
      </div>
      
      <p style="margin-top: 30px;">特此證明。</p>
    </div>
    
    <div class="footer">
      <p>${todayStr}</p>
      <p style="font-weight: bold; font-size: 18px;">${companyName}</p>
      <div class="company-seal">（公司章）</div>
    </div>
  </div>
</body>
</html>
    `;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('生成離職證明預覽失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
