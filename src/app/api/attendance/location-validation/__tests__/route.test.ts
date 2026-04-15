import { NextRequest } from 'next/server';
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  getActiveAllowedLocations,
  getGPSSettingsFromDB,
  validateGpsClockLocation,
} from '@/lib/gps-attendance';

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/gps-attendance', () => ({
  ...jest.requireActual('@/lib/gps-attendance'),
  getGPSSettingsFromDB: jest.fn(),
  getActiveAllowedLocations: jest.fn(),
  validateGpsClockLocation: jest.fn(),
}));

const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedGetGPSSettingsFromDB = getGPSSettingsFromDB as jest.MockedFunction<typeof getGPSSettingsFromDB>;
const mockedGetActiveAllowedLocations = getActiveAllowedLocations as jest.MockedFunction<typeof getActiveAllowedLocations>;
const mockedValidateGpsClockLocation = validateGpsClockLocation as jest.MockedFunction<typeof validateGpsClockLocation>;

describe('attendance location-validation body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedGetGPSSettingsFromDB.mockResolvedValue({ enabled: true } as never);
    mockedGetActiveAllowedLocations.mockResolvedValue([] as never);
    mockedValidateGpsClockLocation.mockReturnValue({ ok: true, code: 'VALID' } as never);
  });

  it('rejects malformed json payloads without reading GPS settings', async () => {
    const response = await POST(new NextRequest('http://localhost/api/attendance/location-validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"location":',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的 GPS 驗證資料' });
    expect(mockedGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockedValidateGpsClockLocation).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before reading GPS settings', async () => {
    const response = await POST(new NextRequest('http://localhost/api/attendance/location-validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的 GPS 驗證資料' });
    expect(mockedGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockedValidateGpsClockLocation).not.toHaveBeenCalled();
  });

  it('rejects malformed location payloads before validation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/attendance/location-validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location: {
          latitude: '25.03',
          longitude: 121.56,
          accuracy: 10,
        },
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'GPS定位資料格式錯誤' });
    expect(mockedGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockedValidateGpsClockLocation).not.toHaveBeenCalled();
  });

  it('rejects out-of-range coordinates before validation', async () => {
    const response = await POST(new NextRequest('http://localhost/api/attendance/location-validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        location: {
          latitude: 120,
          longitude: 121.56,
          accuracy: 10,
        },
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'GPS定位資料格式錯誤' });
    expect(mockedGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockedValidateGpsClockLocation).not.toHaveBeenCalled();
  });
});