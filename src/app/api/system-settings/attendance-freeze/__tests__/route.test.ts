import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/system-settings/attendance-freeze/route';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';

jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('attendance freeze route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedPrisma.systemSettings.findFirst.mockResolvedValue(null);
    mockedPrisma.systemSettings.upsert.mockResolvedValue({
      id: 1,
      key: 'attendance_freeze',
      value: JSON.stringify({
        freezeDay: 5,
        freezeTime: '18:00',
        isEnabled: true,
        description: '每月5日下午6點後，前一個月的考勤記錄將被凍結，無法修改。',
      }),
      description: '考勤凍結設定',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockedRateLimit.mockResolvedValue({ allowed: true, remainingRequests: 10, resetTime: Date.now() + 60_000 });
    mockedValidateCSRF.mockResolvedValue({ valid: true });
    mockedGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/attendance-freeze', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.settings).toMatchObject({
      freezeDay: 5,
      freezeTime: '18:00',
      isEnabled: true,
    });
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        freezeDay: 8,
        freezeTime: '20:30',
        isEnabled: false,
        description: '測試更新',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.settings).toMatchObject({
      freezeDay: 8,
      freezeTime: '20:30',
      isEnabled: false,
      description: '測試更新',
    });
  });

  it('falls back to defaults when stored attendance freeze JSON is malformed', async () => {
    mockedPrisma.systemSettings.findFirst.mockResolvedValue({
      key: 'attendance_freeze',
      value: '{bad-json',
      description: '考勤凍結設定',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/attendance-freeze', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.settings).toMatchObject({
      freezeDay: 5,
      freezeTime: '18:00',
      isEnabled: true,
    });
  });

  it('preserves existing attendance freeze fields on partial POST updates', async () => {
    mockedPrisma.systemSettings.findFirst.mockResolvedValue({
      key: 'attendance_freeze',
      value: JSON.stringify({
        freezeDay: 12,
        freezeTime: '21:15',
        isEnabled: false,
        description: '既有凍結設定',
      }),
      description: '考勤凍結設定',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        freezeDay: 15,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.settings).toEqual({
      freezeDay: 15,
      freezeTime: '21:15',
      isEnabled: false,
      description: '既有凍結設定',
    });
  });

  it('rejects null bodies on POST before reading attendance freeze fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請提供有效的設定資料' });
    expect(mockedPrisma.systemSettings.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on POST before reading attendance freeze fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"freezeDay": 8',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrisma.systemSettings.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});