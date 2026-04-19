jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  hashPassword: jest.fn(),
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
    systemSettings: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/employees/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, hashPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockHashPassword = hashPassword as jest.MockedFunction<typeof hashPassword>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
let mockTxEmployeeCreate: jest.Mock;
let mockTxUserCreate: jest.Mock;

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
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockHashPassword.mockResolvedValue('hashed-password' as never);
    mockTxEmployeeCreate = jest.fn().mockResolvedValue({ id: 11, employeeId: 'E011', name: '王小明' });
    mockTxUserCreate = jest.fn().mockResolvedValue({ id: 20 });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      employee: {
        create: mockTxEmployeeCreate,
      },
      user: {
        create: mockTxUserCreate,
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

  it('searches by name and employeeId without broadening department or position filters', async () => {
    await GET(new NextRequest('http://localhost/api/employees?search=%E7%8E%8B&department=%E8%A1%8C%E6%94%BF%E9%83%A8&position=%E5%B0%88%E5%93%A1'));

    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        department: '行政部',
        position: '專員',
        OR: [
          { name: { contains: '王' } },
          { employeeId: { contains: '王' } }
        ]
      })
    }));
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

  it('persists employee email when creating a new employee record', async () => {
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
        email: 'wang@example.com',
        createAccount: false,
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.message).toBe('員工已新增');
    expect(mockTxEmployeeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'wang@example.com',
      }),
    });
    expect(mockTxUserCreate).not.toHaveBeenCalled();
  });

  it('rejects weak account passwords when createAccount is enabled', async () => {
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
        password: '123',
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '密碼不符合安全要求',
      details: expect.arrayContaining(['密碼長度至少需要6位', '這是常見的弱密碼'])
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
