jest.mock('@/lib/database', () => ({
  prisma: {
    compLeaveBalance: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('comp leave list route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
  });

  it('rejects rate-limited requests before reading user context', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false } as never);

    const request = new NextRequest('http://localhost:3000/api/comp-leave/list');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toEqual({ error: 'Too many requests' });
    expect(mockGetUserFromRequest).not.toHaveBeenCalled();
    expect(mockPrisma.compLeaveBalance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before querying balances', async () => {
    mockGetUserFromRequest.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost:3000/api/comp-leave/list');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '未授權訪問' });
    expect(mockPrisma.compLeaveBalance.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('returns only the current employee balance for non-admin roles', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 88,
      userId: 501,
    } as never);
    mockPrisma.compLeaveBalance.findUnique.mockResolvedValue({
      id: 7,
      employeeId: 88,
      totalEarned: 12,
      totalUsed: 4,
      balance: 8,
      pendingEarn: 1,
      pendingUse: 0,
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      employee: {
        id: 88,
        employeeId: 'E088',
        name: '測試員工',
        department: '製造部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/comp-leave/list?department=財務部');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.compLeaveBalance.findUnique).toHaveBeenCalledWith({
      where: { employeeId: 88 },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
          },
        },
      },
    });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.compLeaveBalance.findMany).not.toHaveBeenCalled();
    expect(payload.success).toBe(true);
    expect(payload.balances).toHaveLength(1);
    expect(payload.balances[0].employee.name).toBe('測試員工');
    expect(payload.balances[0].balance).toBe(8);
  });

  it('merges active employees with existing balances and applies department filters for admins', async () => {
    const frozenUpdatedAt = new Date('2026-04-06T08:00:00.000Z');

    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 100,
    } as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 10,
        employeeId: 'A010',
        name: '王小明',
        department: '製造部',
      },
      {
        id: 11,
        employeeId: 'A011',
        name: '李小華',
        department: '製造部',
      },
    ] as never);
    mockPrisma.compLeaveBalance.findMany.mockResolvedValue([
      {
        id: 3,
        employeeId: 10,
        totalEarned: 20,
        totalUsed: 6,
        balance: 14,
        pendingEarn: 2,
        pendingUse: 1,
        updatedAt: frozenUpdatedAt,
      },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/comp-leave/list?department=%E8%A3%BD%E9%80%A0%E9%83%A8');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        department: '製造部',
      },
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
      },
      orderBy: [
        { department: 'asc' },
        { name: 'asc' },
      ],
    });
    expect(mockPrisma.compLeaveBalance.findMany).toHaveBeenCalledWith({
      where: {
        employeeId: { in: [10, 11] },
      },
    });
    expect(payload.success).toBe(true);
    expect(payload.balances).toHaveLength(2);
    expect(payload.balances[0]).toMatchObject({
      id: 3,
      employeeId: 10,
      totalEarned: 20,
      totalUsed: 6,
      balance: 14,
      pendingEarn: 2,
      pendingUse: 1,
      employee: {
        id: 10,
        employeeId: 'A010',
        name: '王小明',
        department: '製造部',
      },
    });
    expect(payload.balances[1]).toMatchObject({
      id: 0,
      employeeId: 11,
      totalEarned: 0,
      totalUsed: 0,
      balance: 0,
      pendingEarn: 0,
      pendingUse: 0,
      employee: {
        id: 11,
        employeeId: 'A011',
        name: '李小華',
        department: '製造部',
      },
    });
    expect(new Date(payload.balances[0].updatedAt).toISOString()).toBe(frozenUpdatedAt.toISOString());
    expect(typeof payload.balances[1].updatedAt).toBe('string');
  });
});