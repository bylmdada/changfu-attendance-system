/**
 * 離職證明生成 API
 * GET: 生成離職證明 PDF
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require('fontkit');
import * as fs from 'fs/promises';
import * as path from 'path';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 只有管理員/HR 可以生成離職證明
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限操作' }, { status: 403 });
    }

    const { id } = await params;
    const recordId = parseInt(id);

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

    // 只能為已完成的離職記錄生成證明
    if (record.status !== 'COMPLETED') {
      return NextResponse.json({ error: '只能為已完成離職的員工生成證明' }, { status: 400 });
    }

    // 生成 PDF
    const pdfBytes = await generateResignationCertificate(record);

    // 返回 PDF
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="resignation_certificate_${record.employee.employeeId}.pdf"`,
      },
    });

  } catch (error) {
    console.error('生成離職證明失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

interface RecordWithEmployee {
  id: number;
  expectedDate: Date;
  actualDate: Date | null;
  reason: string;
  reasonType: string;
  employee: {
    employeeId: string;
    name: string;
    department: string | null;
    position: string | null;
    hireDate: Date;
  };
}

async function generateResignationCertificate(record: RecordWithEmployee): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  
  // 嘗試載入中文字體
  let font;
  let useChineseFont = false;
  
  try {
    // 嘗試載入 Noto Sans TC 字體
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansTC-Regular.ttf');
    const fontBytes = await fs.readFile(fontPath);
    pdfDoc.registerFontkit(fontkit);
    font = await pdfDoc.embedFont(fontBytes);
    useChineseFont = true;
  } catch {
    // 如果沒有中文字體，使用標準字體
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  // 公司名稱
  const companyName = '社團法人宜蘭縣長期照護及社會福祉推廣協會';
  
  // 標題
  const title = useChineseFont ? '離 職 證 明 書' : 'Certificate of Employment Termination';
  const titleSize = 24;
  const titleWidth = font.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (width - titleWidth) / 2,
    y: height - 100,
    size: titleSize,
    font,
    color: rgb(0, 0, 0),
  });

  // 內容
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

  const contentLines = useChineseFont ? [
    `茲證明 ${employee.name} 先生/女士`,
    ``,
    `身分證字號：＿＿＿＿＿＿＿＿＿＿`,
    ``,
    `於本公司服務期間如下：`,
    ``,
    `到職日期：${hireDateStr}`,
    `離職日期：${leaveDateStr}`,
    `任職年資：${tenureStr}`,
    ``,
    `任職部門：${employee.department || '未指定'}`,
    `擔任職位：${employee.position || '未指定'}`,
    ``,
    `離職原因：${reasonTypeMap[record.reasonType] || record.reasonType}`,
    ``,
    `特此證明。`,
  ] : [
    `This is to certify that ${employee.name}`,
    ``,
    `Period of Employment:`,
    `Start Date: ${hireDateStr}`,
    `End Date: ${leaveDateStr}`,
    `Tenure: ${tenureStr}`,
    ``,
    `Department: ${employee.department || 'N/A'}`,
    `Position: ${employee.position || 'N/A'}`,
    ``,
    `Reason: ${reasonTypeMap[record.reasonType] || record.reasonType}`,
  ];

  let yPos = height - 180;
  const lineHeight = 28;
  const fontSize = 14;

  for (const line of contentLines) {
    page.drawText(line, {
      x: 80,
      y: yPos,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    yPos -= lineHeight;
  }

  // 日期和公司章
  const today = new Date();
  const todayStr = `中華民國 ${today.getFullYear() - 1911} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;
  
  page.drawText(todayStr, {
    x: width - 250,
    y: 180,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });

  page.drawText(companyName, {
    x: width - 250,
    y: 150,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });

  // 公司章區域提示
  page.drawText(useChineseFont ? '（公司章）' : '(Company Seal)', {
    x: width - 200,
    y: 100,
    size: 10,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}
