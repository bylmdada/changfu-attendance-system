jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
    },
    annualLeave: {
      findMany: jest.fn(),
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
import { GET, POST } from '@/app/api/annual-leaves/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('annual leave route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1, userId: 1 } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      hireDate: new Date('2016-06-15T00:00:00.000Z'),
    } as never);
    mockPrisma.annualLeave.findUnique.mockResolvedValue({
      id: 9,
      usedDays: 4.5,
      remainingDays: 2.5,
      totalDays: 7,
    } as never);
    mockPrisma.annualLeave.upsert.mockResolvedValue({ id: 9 } as never);
  });

  it('preserves used days when recalculating remaining days on update', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 10, year: 2026, yearsOfService: 1 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.annualLeave.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          totalDays: 7,
          remainingDays: 2.5,
        }),
      })
    );
  });

  it('grants three days for half-year service in manual setup', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 10, year: 2026, yearsOfService: 0.5 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.annualLeave.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          yearsOfService: 0,
          totalDays: 3,
        }),
      }),
    );
  });

  it('keeps ten years of service at fifteen days and uses anniversary expiry', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 10, year: 2026, yearsOfService: 10 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.annualLeave.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          yearsOfService: 10,
          totalDays: 15,
          expiryDate: new Date(2027, 5, 14),
        }),
      }),
    );
  });

  it('rejects malformed year query parameters before querying annual leave records', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves?year=2026abc', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'year 參數格式無效' });
    expect(mockPrisma.annualLeave.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed yearsOfService payload before recalculating leave days', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 10, year: 2026, yearsOfService: '1.5' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'yearsOfService 參數格式無效' });
    expect(mockPrisma.annualLeave.upsert).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring annual leave payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves', {
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
    expect(payload).toEqual({ error: '請提供有效的年假設定資料' });
    expect(mockPrisma.annualLeave.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating annual leave payload fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/annual-leaves', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"employeeId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.annualLeave.upsert).not.toHaveBeenCalled();
  });
});