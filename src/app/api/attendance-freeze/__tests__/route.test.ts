jest.mock('@/lib/database', () => ({
  prisma: {
    attendanceFreeze: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
    payrollRecord: {
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('attendance freeze csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 15,
      username: 'hr-user',
      role: 'HR',
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.attendanceFreeze.findFirst.mockResolvedValue(null as never);
    mockPrisma.attendanceFreeze.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.employee.findMany.mockResolvedValue([] as never);
    mockPrisma.payrollRecord.findMany.mockResolvedValue([] as never);
  });

  it('rejects POST when csrf validation fails before creating a freeze record', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        freezeDate: '2026-04-08T00:00:00.000Z',
        targetMonth: 4,
        targetYear: 2026,
        description: '月結凍結',
        autoCalculatePayroll: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.attendanceFreeze.create).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring freeze payloads', async () => {
    const request = new NextRequest('http://localhost/api/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的凍結設定資料' });
    expect(mockPrisma.attendanceFreeze.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before destructuring freeze payloads', async () => {
    const request = new NextRequest('http://localhost/api/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: '{"freezeDate":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.attendanceFreeze.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceFreeze.create).not.toHaveBeenCalled();
  });

  it('rejects malformed target month and year strings before Prisma writes', async () => {
    const request = new NextRequest('http://localhost/api/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        freezeDate: '2026-04-08T00:00:00.000Z',
        targetMonth: '4abc',
        targetYear: '2026abc',
        description: '月結凍結',
        autoCalculatePayroll: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '目標月份或年份格式不正確' });
    expect(mockPrisma.attendanceFreeze.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceFreeze.create).not.toHaveBeenCalled();
  });

  it('rejects malformed freeze dates before Prisma writes', async () => {
    const request = new NextRequest('http://localhost/api/attendance-freeze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        freezeDate: 'not-a-date',
        targetMonth: 4,
        targetYear: 2026,
        description: '月結凍結',
        autoCalculatePayroll: false,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '凍結日期格式不正確' });
    expect(mockPrisma.attendanceFreeze.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceFreeze.create).not.toHaveBeenCalled();
  });
});