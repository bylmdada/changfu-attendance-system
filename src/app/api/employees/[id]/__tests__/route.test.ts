jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    passwordHistory: {
      findMany: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { GET, PUT, DELETE } from '@/app/api/employees/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, verifyPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
let mockTxEmployeeUpdate: jest.Mock;
let mockTxUserUpdate: jest.Mock;
let mockTxUserCreate: jest.Mock;
let mockTxUserFindFirst: jest.Mock;

describe('employee detail route guards', () => {
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

    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 10,
      employeeId: 'E010',
      name: '王小明',
      user: { id: 50, username: 'wang', role: 'EMPLOYEE', isActive: true, passwordHash: 'old-hash' },
    } as never);
    mockVerifyPassword.mockResolvedValue(false as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.passwordHistory.findMany.mockResolvedValue([] as never);
    mockTxEmployeeUpdate = jest.fn().mockResolvedValue({ id: 10, employeeId: 'E010', name: '王小明', isActive: true });
    mockTxUserUpdate = jest.fn().mockResolvedValue({ id: 50 });
    mockTxUserCreate = jest.fn().mockResolvedValue({ id: 50 });
    mockTxUserFindFirst = jest.fn().mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      employee: {
        update: mockTxEmployeeUpdate,
      },
      user: {
        update: mockTxUserUpdate,
        create: mockTxUserCreate,
        findFirst: mockTxUserFindFirst,
      },
    } as never) as never);
  });

  it('rejects malformed id path segments instead of coercing them with parseInt', async () => {
    const response = await GET(new NextRequest('http://localhost/api/employees/10abc'), {
      params: Promise.resolve({ id: '10abc' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的員工ID' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects non-boolean isActive partial updates', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({ isActive: 'false' }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'isActive 參數格式無效' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('invalidates the existing session and records password history when updating an account password', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E010',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 40000,
        hourlyRate: 250,
        department: '行政部',
        position: '主任',
        createAccount: true,
        username: 'wang',
        password: 'Nex!Pass77',
        role: 'EMPLOYEE',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toBe('員工資料已更新');
    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 50 },
      data: expect.objectContaining({
        username: 'wang',
        currentSessionId: null,
        passwordHistories: {
          create: {
            passwordHash: 'old-hash'
          }
        }
      }),
    });
  });

  it('rejects malformed id path segments for delete requests as well', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/employees/10abc', {
      method: 'DELETE',
      headers: {
        'x-csrf-token': 'csrf-token',
      },
    }), {
      params: Promise.resolve({ id: '10abc' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的員工ID' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('persists editable employee fields and allows manager role updates without forcing a password reset', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E010',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 40000,
        hourlyRate: 250,
        department: '行政部',
        position: '主任',
        employeeType: 'HOURLY',
        laborInsuranceActive: false,
        email: 'wang@example.com',
        createAccount: true,
        username: 'wang',
        password: '',
        role: 'MANAGER',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toBe('員工資料已更新');
    expect(mockTxEmployeeUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        email: 'wang@example.com',
        employeeType: 'HOURLY',
        laborInsuranceActive: false,
      }),
    });
    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 50 },
      data: {
        username: 'wang',
        role: 'MANAGER',
      },
    });
    expect(mockTxUserCreate).not.toHaveBeenCalled();
  });

  it('rejects weak passwords before updating an existing account', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E010',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 40000,
        hourlyRate: 250,
        department: '行政部',
        position: '主任',
        createAccount: true,
        username: 'wang',
        password: '123',
        role: 'EMPLOYEE',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '密碼不符合安全要求',
      details: expect.arrayContaining(['密碼長度至少需要6位', '這是常見的弱密碼'])
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
