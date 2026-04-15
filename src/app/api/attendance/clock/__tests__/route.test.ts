jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    attendanceRecord: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
    schedule: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/schedule-confirm-service', () => ({
  canEmployeeClockIn: jest.fn(),
}));

jest.mock('@/lib/device-detection', () => ({
  isMobileClockingDevice: jest.fn(),
  MOBILE_CLOCKING_REQUIRED_MESSAGE: 'mobile only',
}));

jest.mock('@/lib/gps-attendance', () => ({
  ...jest.requireActual('@/lib/gps-attendance'),
  getGPSSettingsFromDB: jest.fn(),
  getActiveAllowedLocations: jest.fn(),
  validateGpsClockLocation: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { canEmployeeClockIn } from '@/lib/schedule-confirm-service';
import { isMobileClockingDevice } from '@/lib/device-detection';
import { getGPSSettingsFromDB, getActiveAllowedLocations, validateGpsClockLocation } from '@/lib/gps-attendance';

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCanEmployeeClockIn = canEmployeeClockIn as jest.MockedFunction<typeof canEmployeeClockIn>;
const mockedIsMobileClockingDevice = isMobileClockingDevice as jest.MockedFunction<typeof isMobileClockingDevice>;
const mockedGetGPSSettingsFromDB = getGPSSettingsFromDB as jest.MockedFunction<typeof getGPSSettingsFromDB>;
const mockedGetActiveAllowedLocations = getActiveAllowedLocations as jest.MockedFunction<typeof getActiveAllowedLocations>;
const mockedValidateGpsClockLocation = validateGpsClockLocation as jest.MockedFunction<typeof validateGpsClockLocation>;

describe('attendance clock route GPS validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'worker',
      role: 'EMPLOYEE',
      sessionId: 'session-1',
    } as never);

    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remainingRequests: 10, resetTime: Date.now() } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedCanEmployeeClockIn.mockResolvedValue({ allowed: true } as never);
    mockedIsMobileClockingDevice.mockReturnValue(true);
    mockedGetGPSSettingsFromDB.mockResolvedValue({ enabled: true, requiredAccuracy: 50 } as never);
    mockedGetActiveAllowedLocations.mockResolvedValue([{ id: 1, name: 'Office', latitude: 25.0, longitude: 121.0, radius: 100, isActive: true }] as never);
    mockedValidateGpsClockLocation.mockReturnValue({ ok: true, code: 'VALID' } as never);

    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      employee: {
        id: 9,
        name: '測試員工',
      },
    } as never);

    mockedPrisma.attendanceRecord.findFirst.mockResolvedValue(null as never);
    mockedPrisma.attendanceRecord.upsert.mockResolvedValue({
      id: 101,
      clockInTime: '2026-04-11T01:00:00.000Z',
    } as never);
    mockedPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockedPrisma.schedule.findFirst.mockResolvedValue(null as never);
  });

  it('rejects invalid GPS payload before writing attendance data', async () => {
    mockedValidateGpsClockLocation.mockReturnValue({
      ok: false,
      code: 'OUT_OF_RANGE',
      error: '不在允許的打卡範圍內',
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit',
      },
      body: JSON.stringify({
        type: 'in',
        location: { latitude: 25.2, longitude: 121.5, accuracy: 15 },
      }),
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '不在允許的打卡範圍內',
      code: 'OUT_OF_RANGE',
    });
    expect(mockedPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring clock payload', async () => {
    const request = new NextRequest('http://localhost/api/attendance/clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit',
      },
      body: 'null',
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的打卡類型' });
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
    expect(mockedGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockedGetActiveAllowedLocations).not.toHaveBeenCalled();
    expect(mockedValidateGpsClockLocation).not.toHaveBeenCalled();
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.attendanceRecord.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before destructuring clock payload', async () => {
    const request = new NextRequest('http://localhost/api/attendance/clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit',
      },
      body: '{"type":',
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
    expect(mockedGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockedGetActiveAllowedLocations).not.toHaveBeenCalled();
    expect(mockedValidateGpsClockLocation).not.toHaveBeenCalled();
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.attendanceRecord.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
  });

  it('rejects out-of-range coordinates before GPS validation starts', async () => {
    const request = new NextRequest('http://localhost/api/attendance/clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit',
      },
      body: JSON.stringify({
        type: 'in',
        location: { latitude: 120, longitude: 121.0, accuracy: 10 },
      }),
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'GPS定位資料格式錯誤' });
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
    expect(mockedGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockedGetActiveAllowedLocations).not.toHaveBeenCalled();
    expect(mockedValidateGpsClockLocation).not.toHaveBeenCalled();
    expect(mockedPrisma.attendanceRecord.upsert).not.toHaveBeenCalled();
  });

  it('validates GPS payload before allowing a successful clock-in', async () => {
    const request = new NextRequest('http://localhost/api/attendance/clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit',
      },
      body: JSON.stringify({
        type: 'in',
        location: { latitude: 25.0, longitude: 121.0, accuracy: 10, address: 'Office' },
      }),
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockedGetGPSSettingsFromDB).toHaveBeenCalled();
    expect(mockedGetActiveAllowedLocations).toHaveBeenCalled();
    expect(mockedValidateGpsClockLocation).toHaveBeenCalledWith({
      gpsSettings: expect.objectContaining({ enabled: true }),
      location: { latitude: 25.0, longitude: 121.0, accuracy: 10, address: 'Office' },
      allowedLocations: expect.any(Array),
    });
    expect(payload.message).toBe('上班打卡成功');
    expect(mockedPrisma.attendanceRecord.upsert).toHaveBeenCalled();
  });

  it('returns current clock status on GET for authenticated employees', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      employee: { id: 9 },
    } as never);
    mockedPrisma.attendanceRecord.findFirst.mockResolvedValue({
      clockInTime: '2026-04-11T01:00:00.000Z',
      clockOutTime: null,
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/clock');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.hasClockIn).toBe(true);
    expect(payload.hasClockOut).toBe(false);
  });
});