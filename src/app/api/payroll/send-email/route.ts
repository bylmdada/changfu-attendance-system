/**
 * 薪資條 Email 發送 API
 * POST: 發送薪資條 Email
 * GET: 取得發送歷史
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import nodemailer from 'nodemailer';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    const where: Record<string, unknown> = {};
    if (year) where.year = parseInt(year);
    if (month) where.month = parseInt(month);

    const history = await prisma.payslipSendHistory.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take: 100
    });

    return NextResponse.json({
      success: true,
      history
    });

  } catch (error) {
    console.error('取得發送歷史失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const data = await request.json();
    const { payrollIds, year, month } = data;

    if (!payrollIds || !Array.isArray(payrollIds) || payrollIds.length === 0) {
      return NextResponse.json({ error: '請選擇要發送的薪資條' }, { status: 400 });
    }

    // 取得 Email 設定
    const settings = await prisma.payslipEmailSettings.findFirst();
    if (!settings || !settings.enabled) {
      return NextResponse.json({ error: 'Email 發送功能未啟用' }, { status: 400 });
    }

    if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword) {
      return NextResponse.json({ error: 'SMTP 設定不完整' }, { status: 400 });
    }

    // 建立 SMTP transporter
    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort || 587,
      secure: settings.smtpSecure,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPassword
      }
    });

    // 取得薪資條資料
    const payrolls = await prisma.payrollRecord.findMany({
      where: { id: { in: payrollIds } },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            email: true
          }
        }
      }
    });

    const results: { success: number; failed: number; errors: string[] } = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const payroll of payrolls) {
      const employee = payroll.employee;
      
      if (!employee.email) {
        results.failed++;
        results.errors.push(`${employee.name}: 無 Email`);
        
        await prisma.payslipSendHistory.create({
          data: {
            payrollId: payroll.id,
            employeeId: employee.id,
            employeeName: employee.name,
            employeeEmail: '',
            year: year || payroll.payYear,
            month: month || payroll.payMonth,
            status: 'FAILED',
            errorMessage: '員工無 Email',
            sentBy: user.username
          }
        });
        continue;
      }

      try {
        // 替換變數
        const subject = (settings.subjectTemplate || '')
          .replace(/%YEAR%/g, String(payroll.payYear))
          .replace(/%MONTH%/g, String(payroll.payMonth));

        const body = (settings.bodyTemplate || '')
          .replace(/%YEAR%/g, String(payroll.payYear))
          .replace(/%MONTH%/g, String(payroll.payMonth))
          .replace(/%NAME%/g, employee.name)
          .replace(/%EMPLOYEE_ID%/g, employee.employeeId);

        // 發送 Email
        await transporter.sendMail({
          from: `"${settings.fromName || '薪資系統'}" <${settings.fromEmail || settings.smtpUser}>`,
          to: employee.email,
          subject,
          text: body,
          html: body.replace(/\n/g, '<br>')
        });

        results.success++;

        await prisma.payslipSendHistory.create({
          data: {
            payrollId: payroll.id,
            employeeId: employee.id,
            employeeName: employee.name,
            employeeEmail: employee.email,
            year: payroll.payYear,
            month: payroll.payMonth,
            status: 'SUCCESS',
            sentBy: user.username
          }
        });

      } catch (err) {
        results.failed++;
        const errorMessage = err instanceof Error ? err.message : '發送失敗';
        results.errors.push(`${employee.name}: ${errorMessage}`);

        await prisma.payslipSendHistory.create({
          data: {
            payrollId: payroll.id,
            employeeId: employee.id,
            employeeName: employee.name,
            employeeEmail: employee.email || '',
            year: payroll.payYear,
            month: payroll.payMonth,
            status: 'FAILED',
            errorMessage,
            sentBy: user.username
          }
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `發送完成：成功 ${results.success} 筆，失敗 ${results.failed} 筆`,
      results
    });

  } catch (error) {
    console.error('發送薪資條 Email 失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

