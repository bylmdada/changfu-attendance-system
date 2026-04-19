/**
 * PDF 生成與加密 API
 * 
 * 使用 pdf-lib 生成加密的 PDF 薪資條
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getEmployeePDFPassword, PDFSecurityConfig, getDefaultSecurityConfig } from '@/lib/pdf-security';
import { parseIntegerQueryParam } from '@/lib/query-params';

interface PayslipData {
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
}

function parsePayrollId(payrollId: string) {
  const parsed = parseIntegerQueryParam(payrollId, { min: 1, max: 99999999 });
  return parsed.isValid ? parsed.value : null;
}

function formatPdfAmount(amount: number) {
  return amount.toLocaleString('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function formatPdfTimestamp(date: Date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

async function encryptPdfWithPassword(pdfBytes: Uint8Array, password: string): Promise<Buffer> {
  const { execFile } = await import('child_process');
  const { readFile, unlink, writeFile } = await import('fs/promises');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

  const tempId = `${Date.now()}_${process.pid}`;
  const inputPath = join(tmpdir(), `payslip_${tempId}_input.pdf`);
  const outputPath = join(tmpdir(), `payslip_${tempId}_output.pdf`);

  try {
    await writeFile(inputPath, Buffer.from(pdfBytes));

    await new Promise<void>((resolve, reject) => {
      execFile(
        'qpdf',
        ['--encrypt', password, password, '256', '--', inputPath, outputPath],
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    });

    return await readFile(outputPath);
  } finally {
    for (const filePath of [inputPath, outputPath]) {
      try {
        await unlink(filePath);
      } catch (error) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;

        if (errorCode !== 'ENOENT') {
          console.warn('清理暫存 PDF 檔案失敗:', { filePath, error });
        }
      }
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const payrollId = searchParams.get('payrollId');

    if (!payrollId) {
      return NextResponse.json({ error: '請提供薪資記錄ID' }, { status: 400 });
    }

    const parsedPayrollId = parsePayrollId(payrollId);
    if (parsedPayrollId === null) {
      return NextResponse.json({ error: '薪資記錄ID格式無效' }, { status: 400 });
    }

    // 獲取薪資記錄
    const payrollRecord = await prisma.payrollRecord.findUnique({
      where: { id: parsedPayrollId },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      }
    });

    if (!payrollRecord) {
      return NextResponse.json({ error: '找不到薪資記錄' }, { status: 404 });
    }

    // 權限檢查
    if (user.role !== 'ADMIN' && user.role !== 'HR' && 
        payrollRecord.employeeId !== user.employeeId) {
      return NextResponse.json({ error: '無權限查看此薪資條' }, { status: 403 });
    }

    // 查詢安全設定
    let securityConfig: PDFSecurityConfig = getDefaultSecurityConfig();
    try {
      const templatesSetting = await prisma.systemSettings.findUnique({
        where: { key: 'payslip_templates' }
      });

      if (templatesSetting?.value) {
        const templates = JSON.parse(templatesSetting.value);
        const activeTemplate = Array.isArray(templates)
          ? templates.find((template) => template?.isDefault) || templates[0]
          : null;

        if (activeTemplate?.securityConfig) {
          securityConfig = activeTemplate.securityConfig;
        }
      }
    } catch (e) {
      console.warn('查詢安全設定失敗:', e);
    }

    // 取得密碼
    let password: string | null = null;
    if (securityConfig.passwordProtected) {
      password = await getEmployeePDFPassword(payrollRecord.employeeId, securityConfig);
    }

    // 生成薪資條數據
    const payslipData: PayslipData = {
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
      netPay: payrollRecord.netPay
    };

    // 生成 PDF
    let pdfBytes = await generateEncryptedPDF(payslipData, password);

    // 如果有密碼，使用 qpdf 加密；若加密失敗，直接回傳錯誤避免降級成未加密 PDF
    if (password) {
      pdfBytes = await encryptPdfWithPassword(pdfBytes, password);
      console.log(`PDF encrypted with password for employee: ${payslipData.employee.employeeId}`);
    }

    // 返回 PDF 檔案
    const fileName = `薪資條_${payslipData.employee.name}_${payslipData.period.monthName}.pdf`;
    
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': pdfBytes.length.toString()
      }
    });

  } catch (error) {
    console.error('生成加密PDF失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

async function generateEncryptedPDF(payslip: PayslipData, password: string | null): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const { width, height } = page.getSize();
  let y = height - 50;
  const leftMargin = 50;
  const lineHeight = 25;

  // 嵌入 Logo
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const logoPath = join(process.cwd(), 'public', 'logo.png');
    const logoBytes = await readFile(logoPath);
    const logoImage = await pdfDoc.embedPng(logoBytes);
    
    // 計算 Logo 尺寸（保持比例，高度 50px）
    const logoHeight = 50;
    const logoWidth = (logoImage.width / logoImage.height) * logoHeight;
    
    // 繪製 Logo（左上角）
    page.drawImage(logoImage, {
      x: leftMargin,
      y: y - logoHeight + 20,
      width: logoWidth,
      height: logoHeight
    });
    
    // 標題（Logo 右側）
    page.drawText('Chang Fu Association', {
      x: leftMargin + logoWidth + 20,
      y: y,
      size: 20,
      font: boldFont,
      color: rgb(0.4, 0.5, 0.6)
    });
  } catch (logoError) {
    console.warn('Logo 嵌入失敗，跳過 Logo:', logoError);
    // 沒有 Logo 時只顯示文字標題
    page.drawText('Chang Fu Association', {
      x: leftMargin,
      y,
      size: 20,
      font: boldFont,
      color: rgb(0.4, 0.5, 0.6)
    });
  }
  y -= lineHeight * 1.5;

  page.drawText('Payslip / Salary Statement', {
    x: leftMargin,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2)
  });
  y -= lineHeight;

  page.drawText(`Period: ${payslip.period.year}/${payslip.period.month}`, {
    x: leftMargin,
    y,
    size: 12,
    font,
    color: rgb(0.4, 0.4, 0.4)
  });
  y -= lineHeight * 2;

  // 分隔線
  page.drawLine({
    start: { x: leftMargin, y: y + 10 },
    end: { x: width - leftMargin, y: y + 10 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8)
  });
  y -= lineHeight;

  // 員工資訊
  page.drawText('Employee Information', {
    x: leftMargin,
    y,
    size: 14,
    font: boldFont,
    color: rgb(0.3, 0.3, 0.3)
  });
  y -= lineHeight;

  const drawRow = (label: string, value: string) => {
    page.drawText(label, { x: leftMargin, y, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(value, { x: leftMargin + 150, y, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    y -= lineHeight * 0.8;
  };

  drawRow('Employee ID:', payslip.employee.employeeId);
  drawRow('Name:', payslip.employee.name);
  drawRow('Department:', payslip.employee.department || 'N/A');
  drawRow('Position:', payslip.employee.position || 'N/A');
  y -= lineHeight * 0.5;

  // 薪資組成
  page.drawText('Salary Breakdown', {
    x: leftMargin,
    y,
    size: 14,
    font: boldFont,
    color: rgb(0.3, 0.3, 0.3)
  });
  y -= lineHeight;

  const drawAmountRow = (label: string, amount: number, isDeduction = false) => {
    page.drawText(label, { x: leftMargin, y, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
    const amountStr = `NT$ ${formatPdfAmount(amount)}`;
    const color = isDeduction ? rgb(0.8, 0.2, 0.2) : rgb(0.2, 0.6, 0.2);
    page.drawText(isDeduction ? `-${amountStr}` : amountStr, {
      x: width - leftMargin - 100,
      y,
      size: 10,
      font,
      color
    });
    y -= lineHeight * 0.8;
  };

  drawAmountRow('Base Salary:', payslip.salary.basePay);
  drawAmountRow('Overtime Pay:', payslip.salary.overtimePay);
  y -= lineHeight * 0.3;
  
  page.drawLine({
    start: { x: leftMargin, y: y + 10 },
    end: { x: width - leftMargin, y: y + 10 },
    thickness: 0.5,
    color: rgb(0.9, 0.9, 0.9)
  });
  y -= lineHeight * 0.5;

  drawAmountRow('Gross Pay:', payslip.salary.grossPay);
  y -= lineHeight * 0.5;

  // 扣除項目
  page.drawText('Deductions', {
    x: leftMargin,
    y,
    size: 14,
    font: boldFont,
    color: rgb(0.3, 0.3, 0.3)
  });
  y -= lineHeight;

  drawAmountRow('Labor Insurance:', payslip.deductions.laborInsurance, true);
  drawAmountRow('Health Insurance:', payslip.deductions.healthInsurance, true);
  drawAmountRow('Supplementary Insurance:', payslip.deductions.supplementaryInsurance, true);
  drawAmountRow('Income Tax:', payslip.deductions.incomeTax, true);
  y -= lineHeight * 0.3;
  
  page.drawLine({
    start: { x: leftMargin, y: y + 10 },
    end: { x: width - leftMargin, y: y + 10 },
    thickness: 0.5,
    color: rgb(0.9, 0.9, 0.9)
  });
  y -= lineHeight * 0.5;

  drawAmountRow('Total Deductions:', payslip.deductions.total, true);
  y -= lineHeight;

  // 實領薪資
  page.drawRectangle({
    x: leftMargin,
    y: y - 5,
    width: width - leftMargin * 2,
    height: 35,
    color: rgb(0.95, 0.95, 0.95)
  });

  page.drawText('Net Pay:', {
    x: leftMargin + 10,
    y: y + 5,
    size: 14,
    font: boldFont,
    color: rgb(0.3, 0.3, 0.3)
  });

  page.drawText(`NT$ ${formatPdfAmount(payslip.netPay)}`, {
    x: width - leftMargin - 110,
    y: y + 5,
    size: 14,
    font: boldFont,
    color: rgb(0.2, 0.5, 0.3)
  });

  y -= lineHeight * 2;

  // 頁尾
  page.drawText(`Generated: ${formatPdfTimestamp(new Date())}`, {
    x: leftMargin,
    y: 50,
    size: 8,
    font,
    color: rgb(0.7, 0.7, 0.7)
  });

  page.drawText('This payslip is system-generated. Contact HR for inquiries.', {
    x: leftMargin,
    y: 35,
    size: 8,
    font,
    color: rgb(0.7, 0.7, 0.7)
  });

  // 儲存 PDF
  // 注意：pdf-lib 原生不支援密碼加密，密碼已在 API response 中提示
  // 如需真正加密，可使用 crypto-js 或其他加密庫
  if (password) {
    console.log(`PDF will be generated with password hint for user (password: ${password.substring(0, 2)}***)`);
  }
  
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
