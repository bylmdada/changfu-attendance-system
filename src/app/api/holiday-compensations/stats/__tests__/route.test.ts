import { NextRequest } from 'next/server';
import { GET } from '@/app/api/holiday-compensations/stats/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    holiday: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    holidayCompensation: {
      findMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('holiday compensation stats authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({ userId: 1 } as never);
    mockPrisma.holiday.count.mockResolvedValue(3 as never);
    mockPrisma.holiday.findMany.mockResolvedValue([] as never);
    mockPrisma.holidayCompensation.findMany.mockResolvedValue([] as never);
    mockPrisma.employee.findMany.mockResolvedValue([] as never);
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/holiday-compensations/stats'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
  });

  it('ignores query employeeId overrides for non-admin users', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 7,
    } as never);

    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 7,
      name: 'Own Employee',
      employeeId: 'E007',
      department: '製造部',
    } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/holiday-compensations/stats?year=2025&employeeId=99', {
        headers: { Authorization: 'Bearer test-token' },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.type).toBe('individual');
    expect(payload.employee.id).toBe(7);
    expect(mockPrisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { id: true, name: true, employeeId: true, department: true },
    });
    expect(mockPrisma.holidayCompensation.findMany).toHaveBeenCalledWith({
      where: { employeeId: 7, year: 2025 },
      orderBy: { holidayDate: 'asc' },
    });
  });

  it('still allows HR users to query a specific employee', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      role: 'HR',
      employeeId: 88,
    } as never);

    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 99,
      name: 'Queried Employee',
      employeeId: 'E099',
      department: '人資部',
    } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/holiday-compensations/stats?year=2025&employeeId=99', {
        headers: { Authorization: 'Bearer hr-token' },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.employee.id).toBe(99);
    expect(mockPrisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 99 },
      select: { id: true, name: true, employeeId: true, department: true },
    });
    expect(mockPrisma.holidayCompensation.findMany).toHaveBeenCalledWith({
      where: { employeeId: 99, year: 2025 },
      orderBy: { holidayDate: 'asc' },
    });
  });
});