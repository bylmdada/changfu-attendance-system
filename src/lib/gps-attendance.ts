import { prisma } from '@/lib/database';

export interface GPSSettings {
  enabled: boolean;
  requiredAccuracy: number;
  allowOfflineMode: boolean;
  offlineGracePeriod: number;
  maxDistanceVariance: number;
  verificationTimeout: number;
  enableLocationHistory: boolean;
  requireAddressInfo: boolean;
}

export interface ClockLocationPayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isClockLocationPayload(value: unknown): value is ClockLocationPayload {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    typeof value.accuracy === 'number' &&
    Number.isFinite(value.accuracy) &&
    value.accuracy >= 0 &&
    (value.address === undefined || value.address === null || typeof value.address === 'string')
  );
}

export interface AllowedLocationLite {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  isActive: boolean;
}

export type GpsValidationCode =
  | 'GPS_DISABLED'
  | 'OFFLINE_ALLOWED'
  | 'NO_ACTIVE_LOCATIONS'
  | 'VALID'
  | 'LOCATION_REQUIRED'
  | 'ACCURACY_TOO_LOW'
  | 'OUT_OF_RANGE';

export type GpsValidationResult =
  | {
      ok: true;
      code: 'GPS_DISABLED' | 'OFFLINE_ALLOWED' | 'NO_ACTIVE_LOCATIONS' | 'VALID';
    }
  | {
      ok: false;
      code: 'LOCATION_REQUIRED' | 'ACCURACY_TOO_LOW' | 'OUT_OF_RANGE';
      error: string;
      nearestLocation?: string;
      nearestDistance?: number;
    };

export const defaultGPSSettings: GPSSettings = {
  enabled: true,
  requiredAccuracy: 50,
  allowOfflineMode: false,
  offlineGracePeriod: 5,
  maxDistanceVariance: 20,
  verificationTimeout: 30,
  enableLocationHistory: true,
  requireAddressInfo: true,
};

const GPS_SETTINGS_KEY = 'gps_settings';

export async function getGPSSettingsFromDB(): Promise<GPSSettings> {
  try {
    const setting = await prisma.systemSettings.findUnique({
      where: { key: GPS_SETTINGS_KEY },
    });

    if (setting) {
      return {
        ...defaultGPSSettings,
        ...JSON.parse(setting.value),
      } as GPSSettings;
    }
  } catch (error) {
    console.error('讀取 GPS 設定失敗:', error);
  }

  return { ...defaultGPSSettings };
}

export async function getActiveAllowedLocations(): Promise<AllowedLocationLite[]> {
  return prisma.allowedLocation.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      radius: true,
      isActive: true,
    },
  });
}

export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusMeters = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

export function validateGpsClockLocation({
  gpsSettings,
  location,
  allowedLocations,
}: {
  gpsSettings: GPSSettings;
  location?: ClockLocationPayload | null;
  allowedLocations: AllowedLocationLite[];
}): GpsValidationResult {
  if (!gpsSettings.enabled) {
    return { ok: true, code: 'GPS_DISABLED' };
  }

  if (!location) {
    if (gpsSettings.allowOfflineMode) {
      return { ok: true, code: 'OFFLINE_ALLOWED' };
    }

    return {
      ok: false,
      code: 'LOCATION_REQUIRED',
      error: 'GPS定位失敗，請確保GPS功能已開啟且允許定位權限',
    };
  }

  const roundedAccuracy = Math.round(location.accuracy);
  if (location.accuracy > gpsSettings.requiredAccuracy) {
    return {
      ok: false,
      code: 'ACCURACY_TOO_LOW',
      error: `GPS精確度不足（±${roundedAccuracy}公尺，需在±${gpsSettings.requiredAccuracy}公尺內），請移動到GPS訊號較好的位置`,
    };
  }

  const activeLocations = allowedLocations.filter((item) => item.isActive);
  if (activeLocations.length === 0) {
    return { ok: true, code: 'NO_ACTIVE_LOCATIONS' };
  }

  let nearestLocation: string | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const allowedLocation of activeLocations) {
    const distance = calculateDistanceMeters(
      location.latitude,
      location.longitude,
      allowedLocation.latitude,
      allowedLocation.longitude
    );

    if (distance <= allowedLocation.radius) {
      return { ok: true, code: 'VALID' };
    }

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestLocation = allowedLocation.name;
    }
  }

  const roundedDistance = Number.isFinite(nearestDistance)
    ? Math.round(nearestDistance)
    : undefined;

  return {
    ok: false,
    code: 'OUT_OF_RANGE',
    error:
      nearestLocation && roundedDistance !== undefined
        ? `不在允許的打卡範圍內。距離${nearestLocation}約${roundedDistance}公尺`
        : '不在允許的打卡範圍內',
    nearestLocation,
    nearestDistance: roundedDistance,
  };
}