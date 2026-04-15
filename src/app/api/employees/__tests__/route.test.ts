jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/employees/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;

describe('employees route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
      sessionId: 'session-1',
    } as never);
    mockGetManageableDepartments.mockResolvedValue(['行政部'] as never);
    mockPrisma.employee.findMany.mockResolvedValue([] as never);
    mockPrisma.employee.count.mockResolvedValue(0 as never);
    mockPrisma.employee.findUnique.mockResolvedValue(null as never);
    mockPrisma.user.findUnique.mockResolvedValue(null as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      employee: {
        create: jest.fn().mockResolvedValue({ id: 11, employeeId: 'E011', name: '王小明' }),
      },
      user: {
        create: jest.fn().mockResolvedValue({ id: 20 }),
      },
    } as never) as never);
  });

  it('rejects malformed pagination query values instead of coercing them with parseInt', async () => {
    const response = await GET(new NextRequest('http://localhost/api/employees?page=1abc&limit=10'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'page 參數格式無效' });
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before creating an employee', async () => {
    const response = await POST(new NextRequest('http://localhost/api/employees', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: '{bad-json',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires both username and password when createAccount is true', async () => {
    const response = await POST(new NextRequest('http://localhost/api/employees', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E100',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 40000,
        hourlyRate: 250,
        department: '行政部',
        position: '專員',
        createAccount: true,
        username: 'wang',
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '建立帳號時必須提供 username 和 password' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});