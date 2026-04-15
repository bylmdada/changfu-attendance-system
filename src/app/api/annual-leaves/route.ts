import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import {
  calculateAnnualLeaveDaysFromYearsOfService,
  calculateAnnualLeaveExpiryDate,
} from '@/lib/annual-leave-rules';

function parsePositiveIntegerBodyValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return { value: null, isValid: false };
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return { value: null, isValid: false };
  }

  return parseIntegerQueryParam(String(value), {
    min: 1,
    max: 99999999,
  });
}

function parseNonNegativeNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 99) {
    return { value: null, isValid: false };
  }

  return { value, isValid: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const yearResult = parseIntegerQueryParam(searchParams.get('year'), {
      defaultValue: new Date().getFullYear(),
      min: 1,
      max: 9999,
    });

    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json({ error: 'year 參數格式無效' }, { status: 400 });
    }

    // 建立篩選條件
    const where: {
      employeeId?: number;
      year: number;
    } = {
      year: yearResult.value
    };
    
    // 如果是一般員工，只能查看自己的年假
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      where.employeeId = user.employeeId;
    } else if (employeeId) {
      const employeeIdResult = parseIntegerQueryParam(employeeId, { min: 1, max: 99999999 });
      if (!employeeIdResult.isValid || employeeIdResult.value === null) {
        return NextResponse.json({ error: 'employeeId 參數格式無效' }, { status: 400 });
      }

      where.employeeId = employeeIdResult.value;
    }

    const annualLeaves = await prisma.annualLeave.findMany({
      where,
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
      },
      orderBy: [
        { employee: { name: 'asc' } }
      ]
    });

    return NextResponse.json({ annualLeaves });
  } catch (error) {
    console.error('獲取年假記錄失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/annual-leaves');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '年假操作過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.retryAfter 
        },
        { 
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          }
        }
      );
    }

    // 2. CSRF保護檢查
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    // 3. 身份驗證
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    // 只有管理員和HR可以設定年假
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的年假設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;

    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的年假設定資料' }, { status: 400 });
    }

    const { employeeId, year, yearsOfService } = body;

    if (!employeeId || !year || yearsOfService === undefined) {
      return NextResponse.json({ error: '員工ID、年份和服務年資為必填' }, { status: 400 });
    }

    const employeeIdResult = parsePositiveIntegerBodyValue(employeeId);
    if (!employeeIdResult.isValid || employeeIdResult.value === null) {
      return NextResponse.json({ error: 'employeeId 參數格式無效' }, { status: 400 });
    }

    const yearResult = parsePositiveIntegerBodyValue(year);
    if (!yearResult.isValid || yearResult.value === null) {
      return NextResponse.json({ error: 'year 參數格式無效' }, { status: 400 });
    }

    const yearsOfServiceResult = parseNonNegativeNumber(yearsOfService);
    if (!yearsOfServiceResult.isValid || yearsOfServiceResult.value === null) {
      return NextResponse.json({ error: 'yearsOfService 參數格式無效' }, { status: 400 });
    }

    const employeeIdValue = employeeIdResult.value;
    const yearValue = yearResult.value;
    const yearsOfServiceValue = yearsOfServiceResult.value;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeIdValue },
      select: { hireDate: true },
    });

    if (!employee) {
      return NextResponse.json({ error: '找不到指定的員工' }, { status: 404 });
    }

    const entitlement = calculateAnnualLeaveDaysFromYearsOfService(yearsOfServiceValue);
    const totalDays = entitlement.days;
    const expiryDate = calculateAnnualLeaveExpiryDate(employee.hireDate, yearValue);

    const existingAnnualLeave = await prisma.annualLeave.findUnique({
      where: {
        employeeId_year: {
          employeeId: employeeIdValue,
          year: yearValue,
        }
      },
      select: {
        usedDays: true,
      }
    });

    const remainingDays = Math.max(0, totalDays - (existingAnnualLeave?.usedDays ?? 0));

    const annualLeave = await prisma.annualLeave.upsert({
      where: {
        employeeId_year: {
          employeeId: employeeIdValue,
          year: yearValue
        }
      },
      update: {
        yearsOfService: entitlement.completedYears,
        totalDays,
        remainingDays,
        expiryDate
      },
      create: {
        employeeId: employeeIdValue,
        year: yearValue,
        yearsOfService: entitlement.completedYears,
        totalDays,
        remainingDays: totalDays,
        expiryDate
      },
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

    return NextResponse.json({
      success: true,
      annualLeave,
      message: '年假設定成功'
    });
  } catch (error) {
    console.error('設定年假失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
