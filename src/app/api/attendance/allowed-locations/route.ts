import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// GET - 獲取所有允許的打卡位置
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/attendance/allowed-locations');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // 認證檢查
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const locations = await prisma.allowedLocation.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({
      success: true,
      locations
    });
  } catch (error) {
    console.error('獲取允許位置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// POST - 新增允許的打卡位置
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/attendance/allowed-locations');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF 保護
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 認證和權限檢查
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { name, latitude, longitude, radius, isActive, department, workHours, wifiSsidList, wifiEnabled, wifiOnly } = body;

    // 驗證必填欄位
    if (!name || latitude === undefined || longitude === undefined || radius === undefined) {
      return NextResponse.json({ error: '名稱、經緯度和半徑為必填欄位' }, { status: 400 });
    }

    const location = await prisma.allowedLocation.create({
      data: {
        name,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius: parseInt(radius),
        isActive: isActive !== false,
        department: department || null,
        workHours: workHours || null,
        wifiSsidList: wifiSsidList || null,
        wifiEnabled: wifiEnabled === true,
        wifiOnly: wifiOnly === true
      }
    });

    return NextResponse.json({
      success: true,
      location,
      message: '位置新增成功'
    }, { status: 201 });
  } catch (error) {
    console.error('新增允許位置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// PUT - 更新允許的打卡位置
export async function PUT(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/attendance/allowed-locations');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF 保護
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 認證和權限檢查
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const body = await request.json();
    const { id, name, latitude, longitude, radius, isActive, department, workHours, wifiSsidList, wifiEnabled, wifiOnly } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少位置ID' }, { status: 400 });
    }

    const location = await prisma.allowedLocation.update({
      where: { id: parseInt(id) },
      data: {
        name,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius: parseInt(radius),
        isActive,
        department: department || null,
        workHours: workHours || null,
        wifiSsidList: wifiSsidList || null,
        wifiEnabled: wifiEnabled === true,
        wifiOnly: wifiOnly === true
      }
    });

    return NextResponse.json({
      success: true,
      location,
      message: '位置更新成功'
    });
  } catch (error) {
    console.error('更新允許位置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// DELETE - 刪除允許的打卡位置
export async function DELETE(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/attendance/allowed-locations');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF 保護
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 認證和權限檢查
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少位置ID' }, { status: 400 });
    }

    await prisma.allowedLocation.delete({
      where: { id: parseInt(id) }
    });

    return NextResponse.json({
      success: true,
      message: '位置刪除成功'
    });
  } catch (error) {
    console.error('刪除允許位置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
