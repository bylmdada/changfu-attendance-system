jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
    },
    annualLeave: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '@/app/api/annual-leaves/batch/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('annual leave batch route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1, userId: 1 } as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 10,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
        name: '王小明',
      },
    ] as never);
    mockPrisma.annualLeave.findUnique.mockResolvedValue({
      id: 3,
      usedDays: 4.5,
      remainingDays: 2.5,
      totalDays: 7,
    } as never);
    mockPrisma.annualLeave.upsert.mockResolvedValue({ id: 3 } as never);
  });

  it('preserves used days when batch recalculating remaining days', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ year: 2026, employeeIds: [10] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.annualLeave.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          remainingDays: 2.5,
        }),
      })
    );
  });

  it('rejects malformed year query parameters before calculating suggestions', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves/batch?year=2026abc', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'year 參數格式無效' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed employeeIds payload before batch recalculation', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ year: 2026, employeeIds: ['10x'] }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'employeeIds 參數格式無效' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring the batch payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的批次設定資料' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating the batch payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"year":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('returns 500 when every selected employee fails annual leave setup', async () => {
    mockPrisma.annualLeave.upsert.mockRejectedValue(new Error('write failed') as never);

    const request = new NextRequest('http://localhost:3000/api/annual-leaves/batch', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ year: 2026, employeeIds: [10] }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      error: '批量設定特休假失敗，請稍後再試',
      results: {
        success: 0,
        failed: 1,
        details: [
          {
            employeeId: 10,
            name: '王小明',
            days: 0,
            status: 'failed',
          },
        ],
      },
    });
  });
});