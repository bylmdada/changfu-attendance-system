import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function parseDateValue(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const parsedDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getUTCFullYear() !== Number(year) ||
    parsedDate.getUTCMonth() !== Number(month) - 1 ||
    parsedDate.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return parsedDate;
}

// 取得國定假日列表
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawYear = searchParams.get('year');
    const year = rawYear ? parsePositiveInteger(rawYear) : null;

    if (rawYear && year === null) {
      return NextResponse.json({ error: '年份格式無效' }, { status: 400 });
    }

    const whereClause = year 
      ? { year, isActive: true }
      : { isActive: true };

    const holidays = await prisma.holiday.findMany({
      where: whereClause,
      orderBy: { date: 'asc' }
    });

    return NextResponse.json({ holidays });
  } catch (error) {
    console.error('取得假日列表失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 新增國定假日
export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const bodyRecord = body as Record<string, unknown>;
    const year = bodyRecord.year;
    const date = bodyRecord.date;
    const name = bodyRecord.name;
    const description = bodyRecord.description;
    const parsedYear = parsePositiveInteger(year);
    const parsedDate = parseDateValue(date);
    const holidayName = typeof name === 'string' ? name.trim() : '';

    if (!year || !date || !holidayName) {
      return NextResponse.json({ error: '年份、日期和名稱為必填' }, { status: 400 });
    }

    if (!parsedYear || !parsedDate) {
      return NextResponse.json({ error: '年份或日期格式無效' }, { status: 400 });
    }

    const holiday = await prisma.holiday.create({
      data: {
        year: parsedYear,
        date: parsedDate,
        name: holidayName,
        description: typeof description === 'string' && description.trim() ? description : null
      }
    });

    return NextResponse.json({ holiday, message: '假日已新增' });
  } catch (error) {
    console.error('新增假日失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 批量新增國定假日（年度）
export async function PUT(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const bodyRecord = body as Record<string, unknown>;
    const year = bodyRecord.year;
    const holidays = bodyRecord.holidays;
    const parsedYear = parsePositiveInteger(year);

    if (!year || !holidays || !Array.isArray(holidays)) {
      return NextResponse.json({ error: '年份和假日列表為必填' }, { status: 400 });
    }

    if (!parsedYear) {
      return NextResponse.json({ error: '年份格式無效' }, { status: 400 });
    }

    console.log('📥 收到假日匯入請求:', { year, count: holidays.length });
    console.log('📥 第一筆資料樣本:', holidays[0]);

    // 驗證並轉換日期
    const holidayImports = holidays as Array<{ date?: unknown; name?: unknown; description?: unknown }>;

    const validHolidays = holidayImports
      .filter((h) => {
        if (!h.date) {
          console.log('⚠️ 缺少日期:', h);
          return false;
        }
        if (!h.name) {
          console.log('⚠️ 缺少名稱:', h);
          return false;
        }
        return true;
      })
      .map((h) => {
        // 確保日期格式正確
        const dateStr = String(h.date).trim();
        const holidayName = typeof h.name === 'string' ? h.name.trim() : String(h.name ?? '').trim();
        
        let dateObj: Date | null = null;
        
        // 格式 1: YYYYMMDD (政府行事曆格式)
        const match0 = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (match0) {
          const [, y, m, d] = match0;
          dateObj = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d)));
        }
        
        // 格式 2: YYYY-MM-DD
        if (!dateObj) {
          const match1 = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          if (match1) {
            const [, y, m, d] = match1;
            dateObj = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d)));
          }
        }
        
        // 格式 3: YYYY/MM/DD
        if (!dateObj) {
          const match2 = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
          if (match2) {
            const [, y, m, d] = match2;
            dateObj = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d)));
          }
        }
        
        // 格式 4: 直接使用 Date 解析
        if (!dateObj) {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) {
            dateObj = parsed;
          }
        }
        
        if (!dateObj || isNaN(dateObj.getTime())) {
          console.log('⚠️ 無法解析日期:', dateStr);
          return null;
        }
        
        return {
          year: parsedYear,
          date: dateObj,
          name: holidayName,
          description: typeof h.description === 'string' && h.description.trim() ? h.description : null
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null && h.name.length > 0);

    console.log('✅ 有效假日數量:', validHolidays.length);
    if (validHolidays.length > 0) {
      console.log('✅ 第一筆有效資料:', validHolidays[0]);
    }

    if (validHolidays.length === 0) {
      return NextResponse.json({ error: '沒有有效的假日資料，請確認日期格式正確' }, { status: 400 });
    }

    // 刪除該年度舊資料
    await prisma.holiday.deleteMany({
      where: { year: parsedYear }
    });

    // 批量新增
    const created = await prisma.holiday.createMany({
      data: validHolidays
    });

    if (created.count === 0) {
      return NextResponse.json({ error: '假日匯入失敗，未新增任何資料' }, { status: 400 });
    }

    console.log('✅ 假日匯入成功:', created.count);

    return NextResponse.json({ 
      message: `已新增 ${created.count} 筆假日`,
      count: created.count
    });
  } catch (error) {
    console.error('批量新增假日失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 刪除國定假日
export async function DELETE(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id');
    const id = rawId ? parsePositiveInteger(rawId) : null;

    if (!rawId) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    if (id === null) {
      return NextResponse.json({ error: '假日 ID 格式無效' }, { status: 400 });
    }

    await prisma.holiday.delete({
      where: { id }
    });

    return NextResponse.json({ message: '假日已刪除' });
  } catch (error) {
    console.error('刪除假日失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
