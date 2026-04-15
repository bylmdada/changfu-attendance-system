jest.mock('@/lib/database', () => ({
  prisma: {
    healthInsuranceDependent: {
      findMany: jest.fn(),
    },
    healthInsuranceConfig: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('dependent statistics route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      username: 'admin',
      employee: null,
    } as never);
  });

  it('returns summary, department, and relationship statistics', async () => {
    mockPrisma.healthInsuranceConfig.findFirst.mockResolvedValue({
      premiumRate: 0.0517,
      maxDependents: 3,
      salaryLevels: [
        { minSalary: 0, maxSalary: 40000, insuredAmount: 40100 },
      ],
    } as never);

    mockPrisma.healthInsuranceDependent.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 10,
        relationship: '配偶',
        startDate: new Date('2024-01-05T00:00:00.000Z'),
        employee: { id: 10, department: 'HR', baseSalary: 36000, insuredBase: 0 },
      },
      {
        id: 2,
        employeeId: 10,
        relationship: '子女',
        startDate: new Date('2024-02-06T00:00:00.000Z'),
        employee: { id: 10, department: 'HR', baseSalary: 36000, insuredBase: 0 },
      },
      {
        id: 3,
        employeeId: 20,
        relationship: '子女',
        startDate: new Date('2024-02-07T00:00:00.000Z'),
        employee: { id: 20, department: 'IT', baseSalary: 36000, insuredBase: 0 },
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/system-settings/dependent-statistics', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      totalDependents: 3,
      totalEmployeesWithDependents: 2,
      averageDependentsPerEmployee: 1.5,
    });
    expect(payload.departmentStats).toEqual([
      { department: 'HR', count: 2 },
      { department: 'IT', count: 1 },
    ]);
    expect(payload.relationshipStats).toEqual([
      { relationship: '子女', count: 2 },
      { relationship: '配偶', count: 1 },
    ]);
    expect(payload.monthlyStats).toEqual([
      { month: 1, dependentCount: 1, estimatedPremium: 2073 },
      { month: 2, dependentCount: 2, estimatedPremium: 4146 },
    ]);
  });
});