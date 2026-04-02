import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  getActiveAllowedLocations,
  getGPSSettingsFromDB,
  type GpsValidationCode,
  validateGpsClockLocation,
} from '@/lib/gps-attendance';

function mapValidationCodeToUi(
  code: GpsValidationCode
): { status: 'valid' | 'invalid' | 'error' | 'disabled'; issueCode: string | null } {
  switch (code) {
    case 'GPS_DISABLED':
      return { status: 'disabled', issueCode: null };
    case 'ACCURACY_TOO_LOW':
      return { status: 'invalid', issueCode: 'accuracy' };
    case 'OUT_OF_RANGE':
      return { status: 'invalid', issueCode: 'range' };
    case 'LOCATION_REQUIRED':
      return { status: 'error', issueCode: 'location_required' };
    case 'OFFLINE_ALLOWED':
    case 'NO_ACTIVE_LOCATIONS':
    case 'VALID':
      return { status: 'valid', issueCode: null };
    default:
      return { status: 'error', issueCode: 'unknown' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request, '/api/attendance/location-validation');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' },
        }
      );
    }

    const { location } = await request.json();
    const gpsSettings = await getGPSSettingsFromDB();
    const allowedLocations = gpsSettings.enabled ? await getActiveAllowedLocations() : [];
    const validation = validateGpsClockLocation({
      gpsSettings,
      location,
      allowedLocations,
    });
    const uiState = mapValidationCodeToUi(validation.code);

    return NextResponse.json({
      success: validation.ok,
      status: uiState.status,
      issueCode: uiState.issueCode,
      error: validation.ok ? '' : validation.error,
    });
  } catch (error) {
    console.error('GPS位置預檢失敗:', error);
    return NextResponse.json(
      {
        success: false,
        status: 'error',
        issueCode: 'unknown',
        error: 'GPS驗證服務異常，請稍後再試',
      },
      { status: 500 }
    );
  }
}