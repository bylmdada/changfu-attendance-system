import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

// 取得國定假日列表
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');

    const whereClause = year 
      ? { year: parseInt(year), isActive: true }
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

    const body = await request.json();
    const { year, date, name, description } = body;

    if (!year || !date || !name) {
      return NextResponse.json({ error: '年份、日期和名稱為必填' }, { status: 400 });
    }

    const holiday = await prisma.holiday.create({
      data: {
        year: parseInt(year),
        date: new Date(date),
        name,
        description: description || null
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

    const body = await request.json();
    const { year, holidays } = body;

    if (!year || !holidays || !Array.isArray(holidays)) {
      return NextResponse.json({ error: '年份和假日列表為必填' }, { status: 400 });
    }

    console.log('📥 收到假日匯入請求:', { year, count: holidays.length });
    console.log('📥 第一筆資料樣本:', holidays[0]);

    // 驗證並轉換日期
    const validHolidays = holidays
      .filter((h: { date: string; name: string }) => {
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
      .map((h: { date: string; name: string; description?: string }) => {
        // 確保日期格式正確
        const dateStr = String(h.date).trim();
        
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
          year: parseInt(year),
          date: dateObj,
          name: h.name,
          description: h.description || null
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    console.log('✅ 有效假日數量:', validHolidays.length);
    if (validHolidays.length > 0) {
      console.log('✅ 第一筆有效資料:', validHolidays[0]);
    }

    if (validHolidays.length === 0) {
      return NextResponse.json({ error: '沒有有效的假日資料，請確認日期格式正確' }, { status: 400 });
    }

    // 刪除該年度舊資料
    await prisma.holiday.deleteMany({
      where: { year: parseInt(year) }
    });

    // 批量新增
    const created = await prisma.holiday.createMany({
      data: validHolidays
    });

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
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    await prisma.holiday.delete({
      where: { id: parseInt(id) }
    });

    return NextResponse.json({ message: '假日已刪除' });
  } catch (error) {
    console.error('刪除假日失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
