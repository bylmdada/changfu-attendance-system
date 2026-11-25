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

jest.mock('@/lib/leave-rules-validator', () => ({
  getLeaveRulesConfig: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { GET } from '@/app/api/my-annual-leave/route';
import { getLeaveRulesConfig } from '@/lib/leave-rules-validator';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockGetLeaveRulesConfig = getLeaveRulesConfig as jest.MockedFunction<typeof getLeaveRulesConfig>;

describe('my annual leave route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 1,
    } as never);
    mockGetLeaveRulesConfig.mockResolvedValue({ annualLeaveRollover: false, annualLeaveRolloverMax: 0 } as never);
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

  it('shows sixteen legal days at ten years of service in admin all view', async () => {
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
    expect(payload.employees[0].legalDays).toBe(16);
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

describe('my annual leave carry-over and pending states', () => {
  const employee = (id: number, name: string) => ({
    id, employeeId: `E00${id}`, name, department: '行政部', position: '專員', hireDate: new Date('2016-06-15T00:00:00.000Z'),
  });
  const adminAll = () => GET(new NextRequest('http://localhost:3000/api/my-annual-leave?mode=all', { headers: { cookie: 'token=session-token' } }));
  // 去年度（2025）剩 2 天：2026-06-14 到期，所以 2026-04-19 還沒到期
  const lastYearRow = (employeeId: number, expiryDate = '2026-06-14T00:00:00.000Z') => ({
    employeeId, year: 2025, totalDays: 15, usedDays: 13, remainingDays: 2, expiryDate: new Date(expiryDate),
  });

  // 管理員全員模式會先查部門清單、再查員工
  const queueAdminEmployees = () => mockPrisma.employee.findMany
    .mockResolvedValueOnce([{ department: '行政部' }] as never)
    .mockResolvedValueOnce([employee(1, '甲'), employee(2, '乙'), employee(3, '丙')] as never);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-19T00:00:00.000Z'));
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1, userId: 1 } as never);
    mockGetLeaveRulesConfig.mockResolvedValue({ annualLeaveRollover: false, annualLeaveRolloverMax: 0 } as never);
  });

  it('lists carry-over as usable only when rollover is allowed and the balance has not expired (all-employee table)', async () => {
    queueAdminEmployees();
    mockGetLeaveRulesConfig.mockResolvedValue({ annualLeaveRollover: true, annualLeaveRolloverMax: 0 } as never);
    mockPrisma.annualLeave.findMany
      .mockResolvedValueOnce([] as never) // 今年
      .mockResolvedValueOnce([lastYearRow(1), lastYearRow(2, '2026-03-31T00:00:00.000Z')] as never); // 去年

    const payload = await (await adminAll()).json();
    const byName = Object.fromEntries(payload.employees.map((e: { name: string; lastYear: unknown }) => [e.name, e.lastYear]));

    expect(byName['甲']).toEqual(expect.objectContaining({ remainingDays: 2, status: 'USABLE', usableDays: 2 }));
    expect(byName['乙']).toEqual(expect.objectContaining({ remainingDays: 2, status: 'EXPIRED', usableDays: 0 }));
    expect(byName['丙']).toBeNull();
  });

  it('shows the same balance as history when the company does not allow rollover', async () => {
    queueAdminEmployees();
    mockPrisma.annualLeave.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([lastYearRow(1)] as never);

    const payload = await (await adminAll()).json();

    expect(payload.employees[0].lastYear).toEqual(expect.objectContaining({ status: 'NOT_ENABLED', usableDays: 0 }));
  });

  it('pairs every employee with their own current and last year rows', async () => {
    queueAdminEmployees();
    mockGetLeaveRulesConfig.mockResolvedValue({ annualLeaveRollover: true, annualLeaveRolloverMax: 0 } as never);
    mockPrisma.annualLeave.findMany
      .mockResolvedValueOnce([
        { employeeId: 3, year: 2026, totalDays: 16, usedDays: 1, remainingDays: 15, expiryDate: new Date('2027-06-14') },
        { employeeId: 1, year: 2026, totalDays: 16, usedDays: 4, remainingDays: 12, expiryDate: new Date('2027-06-14') },
      ] as never)
      .mockResolvedValueOnce([lastYearRow(2)] as never);

    const payload = await (await adminAll()).json();
    const rows = payload.employees as Array<{ name: string; currentYear: { remainingDays: number } | null; lastYear: { remainingDays: number } | null }>;

    expect(rows.map((r) => [r.name, r.currentYear?.remainingDays ?? null, r.lastYear?.remainingDays ?? null])).toEqual([
      ['甲', 12, null],
      ['乙', null, 2],
      ['丙', 15, null],
    ]);
  });

  it('marks an expired last-year balance as expired in the personal view too', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 1, userId: 1 } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ ...employee(1, '甲'), isActive: true } as never);
    mockPrisma.annualLeave.findUnique
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(lastYearRow(1, '2026-03-31T00:00:00.000Z') as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);

    const payload = await (await GET(new NextRequest('http://localhost:3000/api/my-annual-leave', { headers: { cookie: 'token=session-token' } }))).json();

    expect(payload.lastYear.data).toEqual(expect.objectContaining({ isExpired: true, status: 'EXPIRED', usableDays: 0 }));
  });

  it('keeps a request visible through every stage: pending, pending admin and approved', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 1, userId: 1 } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ ...employee(1, '甲'), isActive: true } as never);
    mockPrisma.annualLeave.findUnique.mockResolvedValue(null as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);

    await GET(new NextRequest('http://localhost:3000/api/my-annual-leave', { headers: { cookie: 'token=session-token' } }));

    expect(mockPrisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['PENDING', 'PENDING_ADMIN', 'APPROVED'] } }),
      })
    );
  });
});
