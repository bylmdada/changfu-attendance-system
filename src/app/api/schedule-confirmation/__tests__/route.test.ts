jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    scheduleMonthlyRelease: {
      findFirst: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    scheduleConfirmation: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    schedule: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/schedule-confirm-service', () => ({
  sendSchedulePublishNotification: jest.fn(),
  sendReminderToUnconfirmed: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('schedule confirmation csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 2,
      employeeId: 31,
      username: 'scheduler',
      role: 'ADMIN',
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 31,
      department: '行政部',
    } as never);
    mockPrisma.scheduleMonthlyRelease.findFirst.mockResolvedValue(null as never);
    mockPrisma.scheduleMonthlyRelease.upsert.mockResolvedValue({
      id: 9,
      yearMonth: '2026-04',
      version: 1,
      deadline: new Date('2026-04-30T23:59:59.000Z'),
    } as never);
  });

  it('rejects malformed yearMonth on GET my-status before querying release records', async () => {
    const request = new NextRequest('http://localhost/api/schedule-confirmation?type=my-status&yearMonth=2026-13abc', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('yearMonth 格式錯誤');
    expect(mockPrisma.scheduleMonthlyRelease.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
  });

  it('rejects publish POST when csrf validation fails before mutating release state', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'publish',
        yearMonth: '2026-04',
        department: '行政部',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleMonthlyRelease.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed yearMonth on publish before mutating release state', async () => {
    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        action: 'publish',
        yearMonth: '2026-13abc',
        department: '行政部',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('yearMonth 格式錯誤');
    expect(mockPrisma.scheduleMonthlyRelease.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on POST before reading schedule confirmation payloads', async () => {
    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"action":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleMonthlyRelease.upsert).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before reading schedule confirmation payloads', async () => {
    const request = new NextRequest('http://localhost/api/schedule-confirmation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的班表確認資料');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.scheduleMonthlyRelease.upsert).not.toHaveBeenCalled();
  });
});