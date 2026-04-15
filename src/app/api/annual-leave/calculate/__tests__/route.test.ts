jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/annual-leave-calculator', () => ({
  calculateAnnualLeaveDays: jest.fn(),
  calculateAllEmployeesAnnualLeave: jest.fn(),
  getEmployeeAnnualLeave: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
    },
    annualLeave: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    leaveBalanceHistory: {
      findMany: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/annual-leave/calculate/route';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { calculateAnnualLeaveDays, getEmployeeAnnualLeave } from '@/lib/annual-leave-calculator';
import { prisma } from '@/lib/database';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCalculateAnnualLeaveDays = calculateAnnualLeaveDays as jest.MockedFunction<typeof calculateAnnualLeaveDays>;
const mockGetEmployeeAnnualLeave = getEmployeeAnnualLeave as jest.MockedFunction<typeof getEmployeeAnnualLeave>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('annual-leave calculate GET authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/annual-leave/calculate?year=2026'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '未授權' });
  });

  it('rejects full employee annual-leave listings for non-admin users', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 7, userId: 3 } as never);

    const response = await GET(new NextRequest('http://localhost/api/annual-leave/calculate?year=2026'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '權限不足' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed year query parameters instead of coercing them with parseInt', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 1, userId: 1 } as never);

    const response = await GET(new NextRequest('http://localhost/api/annual-leave/calculate?year=2026abc'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'year 參數格式無效' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects querying another employee annual-leave details for non-admin users', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'EMPLOYEE', employeeId: 7, userId: 3 } as never);

    const response = await GET(new NextRequest('http://localhost/api/annual-leave/calculate?year=2026&employeeId=99'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '權限不足' });
  });

  it('still allows HR users to read the annual-leave calculation list', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 1, userId: 1 } as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 9,
        employeeId: 'E009',
        name: '王小明',
        department: '人資部',
        hireDate: new Date('2020-01-15'),
        annualLeaves: [
          {
            year: 2026,
            yearsOfService: 6,
            totalDays: 14,
            usedDays: 3,
            remainingDays: 11,
            expiryDate: new Date('2027-01-14'),
          },
        ],
      },
    ] as never);
    mockCalculateAnnualLeaveDays.mockReturnValue({
      days: 14,
      description: '6年年資 14 天',
      yearsOfService: 6,
      monthsOfService: 72,
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/annual-leave/calculate?year=2026'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.employees).toHaveLength(1);
    expect(payload.employees[0]).toMatchObject({
      employeeId: 9,
      employeeCode: 'E009',
      name: '王小明',
      calculatedDays: 14,
      needsUpdate: false,
    });
  });

  it('rejects POST when csrf validation fails before recalculating annual leave', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 1, userId: 1 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const response = await POST(new NextRequest('http://localhost/api/annual-leave/calculate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ year: 2026 }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed employeeIds payload before calculating selected employees', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 1, userId: 1 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);

    const response = await POST(new NextRequest('http://localhost/api/annual-leave/calculate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ year: 2026, employeeIds: ['7x'] }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'employeeIds 參數格式無效' });
    expect(mockGetEmployeeAnnualLeave).not.toHaveBeenCalled();
    expect(mockPrisma.annualLeave.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed POST bodies before validating annual leave recalculation payloads', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 1, userId: 1 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);

    const response = await POST(new NextRequest('http://localhost/api/annual-leave/calculate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"year":',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockGetEmployeeAnnualLeave).not.toHaveBeenCalled();
    expect(mockPrisma.annualLeave.upsert).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before validating annual leave recalculation payloads', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'HR', employeeId: 1, userId: 1 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);

    const response = await POST(new NextRequest('http://localhost/api/annual-leave/calculate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的年假計算資料' });
    expect(mockGetEmployeeAnnualLeave).not.toHaveBeenCalled();
    expect(mockPrisma.annualLeave.upsert).not.toHaveBeenCalled();
  });
});