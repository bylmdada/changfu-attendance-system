import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(
  rawValue: unknown,
  fieldName: string,
  options: { allowEmptyAsNull?: boolean } = {}
) {
  if (rawValue === undefined) {
    return { isValid: true, value: undefined } as const;
  }

  if (rawValue === null) {
    return { isValid: true, value: null } as const;
  }

  if (typeof rawValue !== 'string') {
    return { isValid: false, error: `${fieldName}格式無效` } as const;
  }

  const trimmedValue = rawValue.trim();
  if (trimmedValue === '' && options.allowEmptyAsNull) {
    return { isValid: true, value: null } as const;
  }

  return { isValid: true, value: trimmedValue } as const;
}

function parseOptionalBoolean(rawValue: unknown, fieldName: string) {
  if (rawValue === undefined) {
    return { isValid: true, value: undefined } as const;
  }

  if (typeof rawValue !== 'boolean') {
    return { isValid: false, error: `${fieldName}格式無效` } as const;
  }

  return { isValid: true, value: rawValue } as const;
}

function parseFiniteNumber(
  rawValue: unknown,
  fieldName: string,
  options: { min?: number; max?: number } = {}
) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { isValid: false, error: `${fieldName}為必填欄位` };
  }

  const value = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number(rawValue)
      : NaN;

  if (!Number.isFinite(value)) {
    return { isValid: false, error: `${fieldName}格式無效` };
  }

  if ((options.min !== undefined && value < options.min) || (options.max !== undefined && value > options.max)) {
    return { isValid: false, error: `${fieldName}超出允許範圍` };
  }

  return { isValid: true, value };
}

function parseLocationId(rawValue: unknown) {
  const normalized = typeof rawValue === 'number'
    ? String(rawValue)
    : typeof rawValue === 'string'
      ? rawValue
      : null;

  return parseIntegerQueryParam(normalized, { min: 1 });
}

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
    const user = await getUserFromRequest(request);
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
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    if (!isPlainObject(parsedBody.data)) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const body = parsedBody.data;
    const { name, latitude, longitude, radius, isActive, department, workHours, wifiSsidList, wifiEnabled, wifiOnly } = body;

    // 驗證必填欄位
    if (typeof name !== 'string' || name.trim() === '' || latitude === undefined || longitude === undefined || radius === undefined) {
      return NextResponse.json({ error: '名稱、經緯度和半徑為必填欄位' }, { status: 400 });
    }

    const normalizedName = name.trim();
    const normalizedDepartmentResult = normalizeOptionalString(department, '部門', { allowEmptyAsNull: true });
    if (!normalizedDepartmentResult.isValid) {
      return NextResponse.json({ error: normalizedDepartmentResult.error }, { status: 400 });
    }

    const normalizedWorkHoursResult = normalizeOptionalString(workHours, '工時設定', { allowEmptyAsNull: true });
    if (!normalizedWorkHoursResult.isValid) {
      return NextResponse.json({ error: normalizedWorkHoursResult.error }, { status: 400 });
    }

    const normalizedWifiSsidListResult = normalizeOptionalString(wifiSsidList, 'WiFi SSID 清單', { allowEmptyAsNull: true });
    if (!normalizedWifiSsidListResult.isValid) {
      return NextResponse.json({ error: normalizedWifiSsidListResult.error }, { status: 400 });
    }

    const isActiveResult = parseOptionalBoolean(isActive, '啟用狀態');
    if (!isActiveResult.isValid) {
      return NextResponse.json({ error: isActiveResult.error }, { status: 400 });
    }

    const wifiEnabledResult = parseOptionalBoolean(wifiEnabled, 'WiFi 啟用狀態');
    if (!wifiEnabledResult.isValid) {
      return NextResponse.json({ error: wifiEnabledResult.error }, { status: 400 });
    }

    const wifiOnlyResult = parseOptionalBoolean(wifiOnly, '僅限 WiFi');
    if (!wifiOnlyResult.isValid) {
      return NextResponse.json({ error: wifiOnlyResult.error }, { status: 400 });
    }

    const parsedLatitude = parseFiniteNumber(latitude, '緯度', { min: -90, max: 90 });
    if (!parsedLatitude.isValid) {
      return NextResponse.json({ error: parsedLatitude.error }, { status: 400 });
    }
    const latitudeValue = parsedLatitude.value;
    if (latitudeValue === undefined) {
      return NextResponse.json({ error: '緯度格式無效' }, { status: 400 });
    }

    const parsedLongitude = parseFiniteNumber(longitude, '經度', { min: -180, max: 180 });
    if (!parsedLongitude.isValid) {
      return NextResponse.json({ error: parsedLongitude.error }, { status: 400 });
    }
    const longitudeValue = parsedLongitude.value;
    if (longitudeValue === undefined) {
      return NextResponse.json({ error: '經度格式無效' }, { status: 400 });
    }

    const parsedRadius = parseFiniteNumber(radius, '半徑', { min: 1 });
    if (!parsedRadius.isValid) {
      return NextResponse.json({ error: parsedRadius.error }, { status: 400 });
    }
    const radiusValue = parsedRadius.value;
    if (radiusValue === undefined) {
      return NextResponse.json({ error: '半徑格式無效' }, { status: 400 });
    }

    const location = await prisma.allowedLocation.create({
      data: {
        name: normalizedName,
        latitude: latitudeValue,
        longitude: longitudeValue,
        radius: Math.round(radiusValue),
        isActive: isActiveResult.value ?? true,
        department: normalizedDepartmentResult.value ?? null,
        workHours: normalizedWorkHoursResult.value ?? null,
        wifiSsidList: normalizedWifiSsidListResult.value ?? null,
        wifiEnabled: wifiEnabledResult.value ?? false,
        wifiOnly: wifiOnlyResult.value ?? false
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
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    if (!isPlainObject(parsedBody.data)) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const body = parsedBody.data;
    const { id, name, latitude, longitude, radius, isActive, department, workHours, wifiSsidList, wifiEnabled, wifiOnly } = body;

    const parsedId = parseLocationId(id);
    if (!parsedId.isValid || parsedId.value === null) {
      return NextResponse.json({ error: '缺少位置ID' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return NextResponse.json({ error: '名稱格式無效' }, { status: 400 });
      }
      updateData.name = name.trim();
    }

    if (latitude !== undefined) {
      const parsedLatitude = parseFiniteNumber(latitude, '緯度', { min: -90, max: 90 });
      if (!parsedLatitude.isValid) {
        return NextResponse.json({ error: parsedLatitude.error }, { status: 400 });
      }
      updateData.latitude = parsedLatitude.value;
    }

    if (longitude !== undefined) {
      const parsedLongitude = parseFiniteNumber(longitude, '經度', { min: -180, max: 180 });
      if (!parsedLongitude.isValid) {
        return NextResponse.json({ error: parsedLongitude.error }, { status: 400 });
      }
      updateData.longitude = parsedLongitude.value;
    }

    if (radius !== undefined) {
      const parsedRadius = parseFiniteNumber(radius, '半徑', { min: 1 });
      if (!parsedRadius.isValid) {
        return NextResponse.json({ error: parsedRadius.error }, { status: 400 });
      }
      const radiusValue = parsedRadius.value;
      if (radiusValue === undefined) {
        return NextResponse.json({ error: '半徑格式無效' }, { status: 400 });
      }
      updateData.radius = Math.round(radiusValue);
    }

    if (isActive !== undefined) {
      const isActiveResult = parseOptionalBoolean(isActive, '啟用狀態');
      if (!isActiveResult.isValid) {
        return NextResponse.json({ error: isActiveResult.error }, { status: 400 });
      }
      updateData.isActive = isActiveResult.value;
    }

    if (department !== undefined) {
      const normalizedDepartmentResult = normalizeOptionalString(department, '部門', { allowEmptyAsNull: true });
      if (!normalizedDepartmentResult.isValid) {
        return NextResponse.json({ error: normalizedDepartmentResult.error }, { status: 400 });
      }
      updateData.department = normalizedDepartmentResult.value;
    }

    if (workHours !== undefined) {
      const normalizedWorkHoursResult = normalizeOptionalString(workHours, '工時設定', { allowEmptyAsNull: true });
      if (!normalizedWorkHoursResult.isValid) {
        return NextResponse.json({ error: normalizedWorkHoursResult.error }, { status: 400 });
      }
      updateData.workHours = normalizedWorkHoursResult.value;
    }

    if (wifiSsidList !== undefined) {
      const normalizedWifiSsidListResult = normalizeOptionalString(wifiSsidList, 'WiFi SSID 清單', { allowEmptyAsNull: true });
      if (!normalizedWifiSsidListResult.isValid) {
        return NextResponse.json({ error: normalizedWifiSsidListResult.error }, { status: 400 });
      }
      updateData.wifiSsidList = normalizedWifiSsidListResult.value;
    }

    if (wifiEnabled !== undefined) {
      const wifiEnabledResult = parseOptionalBoolean(wifiEnabled, 'WiFi 啟用狀態');
      if (!wifiEnabledResult.isValid) {
        return NextResponse.json({ error: wifiEnabledResult.error }, { status: 400 });
      }
      updateData.wifiEnabled = wifiEnabledResult.value;
    }

    if (wifiOnly !== undefined) {
      const wifiOnlyResult = parseOptionalBoolean(wifiOnly, '僅限 WiFi');
      if (!wifiOnlyResult.isValid) {
        return NextResponse.json({ error: wifiOnlyResult.error }, { status: 400 });
      }
      updateData.wifiOnly = wifiOnlyResult.value;
    }

    const location = await prisma.allowedLocation.update({
      where: { id: parsedId.value },
      data: updateData
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
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const parsedId = parseLocationId(id);
    if (!parsedId.isValid || parsedId.value === null) {
      return NextResponse.json({ error: '缺少位置ID' }, { status: 400 });
    }

    await prisma.allowedLocation.delete({
      where: { id: parsedId.value }
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
