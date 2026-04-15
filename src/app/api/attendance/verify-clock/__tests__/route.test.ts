jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn()
    },
    user: {
      findUnique: jest.fn()
    },
    attendanceRecord: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn()
    },
    schedule: {
      findFirst: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  verifyPassword: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkClockRateLimit: jest.fn(),
  recordFailedClockAttempt: jest.fn(),
  clearFailedAttempts: jest.fn(),
  getClientIP: jest.fn()
}));

jest.mock('@/lib/schedule-confirm-service', () => ({
  canEmployeeClockIn: jest.fn()
}));

jest.mock('@/lib/gps-attendance', () => ({
  ...jest.requireActual('@/lib/gps-attendance'),
  getActiveAllowedLocations: jest.fn(),
  getGPSSettingsFromDB: jest.fn(),
  validateGpsClockLocation: jest.fn()
}));

jest.mock('@/lib/device-detection', () => ({
  isMobileClockingDevice: jest.fn(),
  MOBILE_CLOCKING_REQUIRED_MESSAGE: 'mobile only'
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { verifyPassword } from '@/lib/auth';
import { checkClockRateLimit, recordFailedClockAttempt, getClientIP } from '@/lib/rate-limit';
import { getGPSSettingsFromDB, getActiveAllowedLocations, validateGpsClockLocation } from '@/lib/gps-attendance';
import { isMobileClockingDevice } from '@/lib/device-detection';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockCheckClockRateLimit = checkClockRateLimit as jest.MockedFunction<typeof checkClockRateLimit>;
const mockRecordFailedClockAttempt = recordFailedClockAttempt as jest.MockedFunction<typeof recordFailedClockAttempt>;
const mockGetClientIP = getClientIP as jest.MockedFunction<typeof getClientIP>;
const mockGetGPSSettingsFromDB = getGPSSettingsFromDB as jest.MockedFunction<typeof getGPSSettingsFromDB>;
const mockGetActiveAllowedLocations = getActiveAllowedLocations as jest.MockedFunction<typeof getActiveAllowedLocations>;
const mockValidateGpsClockLocation = validateGpsClockLocation as jest.MockedFunction<typeof validateGpsClockLocation>;
const mockIsMobileClockingDevice = isMobileClockingDevice as jest.MockedFunction<typeof isMobileClockingDevice>;

describe('verify-clock quick auth account status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsMobileClockingDevice.mockReturnValue(true);
    mockCheckClockRateLimit.mockResolvedValue({ allowed: true });
    mockGetClientIP.mockReturnValue('127.0.0.1');
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockGetGPSSettingsFromDB.mockResolvedValue({ enabled: false } as never);
    mockGetActiveAllowedLocations.mockResolvedValue([] as never);
    mockValidateGpsClockLocation.mockReturnValue({ ok: true } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects inactive accounts before accepting a quick clock request', async () => {
    jest.setSystemTime(new Date('2026-04-13T04:00:00.000Z'));

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'inactive.user',
      isActive: false,
      passwordHash: 'hash',
      employee: { id: 9, name: '停用員工' }
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/verify-clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify({ username: 'inactive.user', password: 'secret', type: 'in' })
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('帳號已停用，請聯繫管理員');
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockRecordFailedClockAttempt).toHaveBeenCalledWith('inactive.user');
  });

  it('rejects null request bodies before destructuring quick clock credentials', async () => {
    const request = new NextRequest('http://localhost/api/attendance/verify-clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: 'null'
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('缺少必要參數');
    expect(mockCheckClockRateLimit).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before destructuring quick clock credentials', async () => {
    jest.setSystemTime(new Date('2026-04-13T04:00:00.000Z'));

    const request = new NextRequest('http://localhost/api/attendance/verify-clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: '{"username":'
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockCheckClockRateLimit).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('rejects out-of-range coordinates before rate limiting and authentication', async () => {
    const request = new NextRequest('http://localhost/api/attendance/verify-clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify({
        username: 'worker',
        password: 'secret',
        type: 'in',
        location: {
          latitude: -91,
          longitude: 121.5,
          accuracy: 10
        }
      })
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'GPS定位資料格式錯誤' });
    expect(mockCheckClockRateLimit).not.toHaveBeenCalled();
    expect(mockGetGPSSettingsFromDB).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('uses Taiwan date when looking up the schedule for clock-out', async () => {
    jest.setSystemTime(new Date('2026-04-07T22:30:00.000Z'));

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'worker',
      isActive: true,
      passwordHash: 'hash',
      employee: { id: 9, name: '測試員工' }
    } as never);
    mockVerifyPassword.mockResolvedValue(true);
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 77,
      employeeId: 9,
      clockInTime: '2026-04-07T23:00:00.000Z',
      clockOutTime: null,
      regularHours: 0,
      overtimeHours: 0
    } as never);
    mockPrisma.schedule.findFirst.mockResolvedValue({
      employeeId: 9,
      workDate: '2026-04-08',
      endTime: '18:00'
    } as never);
    mockPrisma.attendanceRecord.update.mockResolvedValue({
      id: 77,
      regularHours: 1.5,
      overtimeHours: 0
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/verify-clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify({ username: 'worker', password: 'secret', clockType: 'out' })
    });

    const response = await POST(request);

    if (!response) {
      throw new Error('Expected response');
    }

    expect(response.status).toBe(200);
    expect(mockPrisma.schedule.findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: 9,
        workDate: '2026-04-08'
      }
    });
  });

  it('returns reason prompt data for late clock-out using Taiwan time', async () => {
    jest.setSystemTime(new Date('2026-04-08T09:30:00.000Z'));

    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'clock_reason_prompt',
      value: JSON.stringify({ enabled: true, lateClockOutThreshold: 15 })
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      username: 'worker',
      isActive: true,
      passwordHash: 'hash',
      employee: { id: 9, name: '測試員工' }
    } as never);
    mockVerifyPassword.mockResolvedValue(true);
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 88,
      employeeId: 9,
      clockInTime: '2026-04-08T00:00:00.000Z',
      clockOutTime: null,
      regularHours: 0,
      overtimeHours: 0
    } as never);
    mockPrisma.schedule.findFirst.mockResolvedValue({
      employeeId: 9,
      workDate: '2026-04-08',
      endTime: '17:00'
    } as never);
    mockPrisma.attendanceRecord.update.mockResolvedValue({
      id: 88,
      regularHours: 9.5,
      overtimeHours: 0
    } as never);

    const request = new NextRequest('http://localhost/api/attendance/verify-clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit'
      },
      body: JSON.stringify({ username: 'worker', password: 'secret', clockType: 'out' })
    });

    const response = await POST(request);
    if (!response) {
      throw new Error('Expected response');
    }
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.requiresReason).toBe(true);
    expect(payload.reasonPrompt).toEqual({
      type: 'LATE_OUT',
      minutesDiff: 30,
      scheduledTime: '17:00',
      recordId: 88
    });
  });
});