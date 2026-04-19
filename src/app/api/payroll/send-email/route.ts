/**
 * 薪資條 Email 發送 API
 * POST: 發送薪資條 Email
 * GET: 取得發送歷史
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { escapeHtml } from '@/lib/html';
import { parseIntegerQueryParam } from '@/lib/query-params';
import nodemailer from 'nodemailer';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSafeMailSendErrorMessage() {
  return '郵件發送失敗，請檢查 SMTP 設定後再試';
}

function getSafeMailSendErrorLog(error: unknown, payrollId: number, employeeId: number) {
  const safeLog: {
    payrollId: number;
    employeeId: number;
    code?: string;
    responseCode?: number;
  } = {
    payrollId,
    employeeId,
  };

  if (error && typeof error === 'object') {
    const maybeError = error as { code?: unknown; responseCode?: unknown };

    if (typeof maybeError.code === 'string') {
      safeLog.code = maybeError.code;
    }

    if (typeof maybeError.responseCode === 'number') {
      safeLog.responseCode = maybeError.responseCode;
    }
  }

  return safeLog;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Number(value);
    if (Number.isInteger(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
  }

  return undefined;
}

function normalizeConfigString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseHistoryFilter(rawValue: string | null, options: { min: number; max: number }) {
  const parsed = parseIntegerQueryParam(rawValue, options);
  return parsed.isValid ? parsed.value : null;
}

async function getPayslipSmtpConfig() {
  const smtpSettings = await prisma.smtpSettings.findFirst();

  const smtpHost = normalizeConfigString(smtpSettings?.smtpHost);
  const smtpUser = normalizeConfigString(smtpSettings?.smtpUser);
  const smtpPassword = typeof smtpSettings?.smtpPassword === 'string' && smtpSettings.smtpPassword !== ''
    ? smtpSettings.smtpPassword
    : null;

  if (!smtpSettings || !smtpHost || !smtpUser || !smtpPassword) {
    return null;
  }

  return {
    host: smtpHost,
    port: smtpSettings.smtpPort ?? 587,
    secure: smtpSettings.smtpSecure ?? false,
    user: smtpUser,
    password: smtpPassword,
    fromName: normalizeConfigString(smtpSettings.fromName) || '長福考勤系統',
    fromEmail: normalizeConfigString(smtpSettings.fromEmail) || smtpUser,
  };
}

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
    const parsedYear = parseHistoryFilter(year, { min: 1900, max: 9999 });
    const parsedMonth = parseHistoryFilter(month, { min: 1, max: 12 });

    if (year && parsedYear === null) {
      return NextResponse.json({ error: '年份格式無效' }, { status: 400 });
    }

    if (month && parsedMonth === null) {
      return NextResponse.json({ error: '月份格式無效' }, { status: 400 });
    }

    const where: Record<string, unknown> = {};
    if (parsedYear !== null) where.year = parsedYear;
    if (parsedMonth !== null) where.month = parsedMonth;

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

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const data = parseResult.data;
    const payrollIds = isPlainObject(data) && Array.isArray(data.payrollIds)
      ? data.payrollIds.reduce<number[]>((validPayrollIds, payrollId) => {
          const parsedPayrollId = parsePositiveInteger(payrollId);
          if (parsedPayrollId !== undefined) {
            validPayrollIds.push(parsedPayrollId);
          }
          return validPayrollIds;
        }, [])
      : undefined;
    const uniquePayrollIds = payrollIds ? Array.from(new Set(payrollIds)) : undefined;
    const year = isPlainObject(data) ? parsePositiveInteger(data.year) : undefined;
    const month = isPlainObject(data) ? parsePositiveInteger(data.month) : undefined;

    if (!uniquePayrollIds || !Array.isArray(uniquePayrollIds) || uniquePayrollIds.length === 0) {
      return NextResponse.json({ error: '請選擇要發送的薪資條' }, { status: 400 });
    }

    // 取得 Email 設定
    const settings = await prisma.payslipEmailSettings.findFirst();
    if (!settings || !settings.enabled) {
      return NextResponse.json({ error: 'Email 發送功能未啟用' }, { status: 400 });
    }

    const smtpConfig = await getPayslipSmtpConfig();
    if (!smtpConfig) {
      return NextResponse.json({ error: 'SMTP 設定不完整' }, { status: 400 });
    }

    const successfulHistory = await prisma.payslipSendHistory.findMany({
      where: {
        payrollId: { in: uniquePayrollIds },
        status: 'SUCCESS',
      },
      select: {
        payrollId: true,
        employeeName: true,
      },
    });
    const successfulPayrollIds = new Set(successfulHistory.map((record) => record.payrollId));

    // 建立 SMTP transporter
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.password
      }
    });

    // 取得薪資條資料
    const payrolls = await prisma.payrollRecord.findMany({
      where: {
        id: {
          in: uniquePayrollIds.filter((payrollId) => !successfulPayrollIds.has(payrollId)),
        },
      },
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

    const results: { success: number; failed: number; skipped: number; errors: string[] } = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    for (const record of successfulHistory) {
      results.skipped++;
      results.errors.push(`${record.employeeName}: 薪資條已寄送過，已略過重複發送`);
    }

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
          from: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
          to: employee.email,
          subject,
          text: body,
          html: escapeHtml(body).replace(/\n/g, '<br>')
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
        const errorMessage = getSafeMailSendErrorMessage();
        results.errors.push(`${employee.name}: ${errorMessage}`);
        console.error('薪資條 Email 發送失敗:', getSafeMailSendErrorLog(err, payroll.id, employee.id));

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
      message: `發送完成：成功 ${results.success} 筆，失敗 ${results.failed} 筆，略過 ${results.skipped} 筆`,
      results
    });

  } catch (error) {
    console.error('發送薪資條 Email 失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
