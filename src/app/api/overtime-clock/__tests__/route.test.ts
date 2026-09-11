import { NextRequest } from 'next/server';
import { POST } from '@/app/api/overtime-clock/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getStoredOvertimeCalculationSettings } from '@/lib/overtime-settings';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/overtime-settings', () => ({
  getStoredOvertimeCalculationSettings: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    allowedLocation: {
      findMany: jest.fn(),
    },
    overtimeClockRecord: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    overtimeRequest: {
      create: jest.fn(),
    },
  },
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedGetSettings = getStoredOvertimeCalculationSettings as jest.MockedFunction<
  typeof getStoredOvertimeCalculationSettings
>;
const mockPrisma = jest.requireMock('@/lib/database').prisma as {
  allowedLocation: { findMany: jest.Mock };
  overtimeClockRecord: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  overtimeRequest: { create: jest.Mock };
};

describe('overtime clock auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedGetSettings.mockResolvedValue({ overtimeMinUnit: 60 } as never);
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockedGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/overtime-clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        clockType: 'START',
        latitude: 25.033,
        longitude: 121.5654,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('未授權訪問');
  });

  it('returns 400 for malformed JSON before overtime clock processing continues', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedGetUserFromRequest.mockResolvedValue({ employeeId: 99, role: 'EMPLOYEE' } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-clock', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('stores every worked minute after a GPS overtime session meets the minimum duration', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T10:19:00.000Z'));
    mockedGetUserFromRequest.mockResolvedValue({ employeeId: 99, role: 'EMPLOYEE' } as never);
    mockPrisma.allowedLocation.findMany.mockResolvedValue([]);
    mockPrisma.overtimeClockRecord.create.mockResolvedValue({ id: 22 } as never);
    mockPrisma.overtimeClockRecord.findFirst.mockResolvedValue({
      id: 21,
      clockTime: new Date('2026-07-17T09:00:00.000Z'),
    } as never);
    mockPrisma.overtimeRequest.create.mockResolvedValue({ id: 23, totalHours: 1.32 } as never);
    mockPrisma.overtimeClockRecord.update.mockResolvedValue({ id: 22 } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/overtime-clock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clockType: 'END',
        latitude: 25.033,
        longitude: 121.5654,
      }),
    }));

    expect(response.status).toBe(200);
    expect(mockPrisma.overtimeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ totalHours: 1.32 }),
    });
    jest.useRealTimers();
  });

  it('does not create a GPS overtime request below the configured minimum duration', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-07-17T10:00:00.000Z'));
      mockedGetUserFromRequest.mockResolvedValue({ employeeId: 99, role: 'EMPLOYEE' } as never);
      mockPrisma.allowedLocation.findMany.mockResolvedValue([]);
      mockPrisma.overtimeClockRecord.create.mockResolvedValue({ id: 32 } as never);
      mockPrisma.overtimeClockRecord.findFirst.mockResolvedValue({
        id: 31,
        clockTime: new Date('2026-07-17T09:01:00.000Z'),
      } as never);

      const response = await POST(new NextRequest('http://localhost:3000/api/overtime-clock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clockType: 'END',
          latitude: 25.033,
          longitude: 121.5654,
        }),
      }));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.overtimeRequest).toBeNull();
      expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
      expect(mockPrisma.overtimeClockRecord.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
