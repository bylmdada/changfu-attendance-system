jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    annualLeave: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { GET } from '@/app/api/my-annual-leave/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('my annual leave route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 1,
    } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses shared annual leave rules for employees with more than six months of service', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-19T00:00:00.000Z'));
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 'E001',
      name: '王小明',
      department: '行政部',
      position: '專員',
      hireDate: new Date('2025-09-19T00:00:00.000Z'),
      isActive: true,
    } as never);
    mockPrisma.annualLeave.findUnique.mockResolvedValue(null as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost:3000/api/my-annual-leave', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.employee.legalDays).toBe(3);
    expect(mockPrisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leaveType: { in: ['ANNUAL', 'ANNUAL_LEAVE'] },
        }),
      })
    );
  });

  it('keeps ten years of service at fifteen legal days in admin all view', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-19T00:00:00.000Z'));
    mockPrisma.employee.findMany
      .mockResolvedValueOnce([{ department: '行政部' }] as never)
      .mockResolvedValueOnce([
        {
          id: 1,
          employeeId: 'E001',
          name: '王小明',
          department: '行政部',
          position: '專員',
          hireDate: new Date('2016-04-19T00:00:00.000Z'),
        },
      ] as never);
    mockPrisma.annualLeave.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost:3000/api/my-annual-leave?mode=all', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.employees[0].legalDays).toBe(15);
  });

  it('rejects malformed admin employeeId query parameters before hitting Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-annual-leave?employeeId=10abc', {
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'employeeId 參數格式無效' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });
});
