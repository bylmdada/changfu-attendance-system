import { NextRequest } from 'next/server';
import { POST, PUT } from '@/app/api/employees/bank-accounts/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { cookies } from 'next/headers';
import { validateTaiwanIdNumber } from '@/lib/encryption';

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/encryption', () => ({
  encrypt: jest.fn((value: string) => `enc:${value}`),
  decrypt: jest.fn((value: string) => value),
  maskIdNumber: jest.fn(() => 'A12*****89'),
  maskBankAccount: jest.fn(() => '1234****5678'),
  validateTaiwanIdNumber: jest.fn(() => true),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockedValidateTaiwanIdNumber = validateTaiwanIdNumber as jest.MockedFunction<typeof validateTaiwanIdNumber>;

describe('employee bank accounts route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedGetUserFromToken.mockResolvedValue(null);
    mockedValidateCSRF.mockResolvedValue({ valid: true });
    mockedCookies.mockResolvedValue({
      get: jest.fn().mockReturnValue(undefined),
    } as never);
    mockedValidateTaiwanIdNumber.mockReturnValue(true);

    mockedPrisma.employee.update.mockResolvedValue({
      id: 10,
      employeeId: 'E001',
      name: '王小明',
      department: '行政部',
    } as never);
    mockedPrisma.employee.findMany.mockResolvedValue([
      {
        id: 10,
        name: '王小明',
        idNumber: null,
      },
    ] as never);
    mockedPrisma.employee.findFirst.mockResolvedValue({
      id: 10,
      name: '王小明',
      idNumber: null,
    } as never);
  });

  it('accepts shared token cookie extraction on PUT requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 10,
        bankAccount: '1234567890123',
      }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('rejects PUT requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });
    mockedCookies.mockResolvedValue({
      get: jest.fn().mockImplementation((key: string) => key === 'auth-token'
        ? { value: 'legacy-auth-token' }
        : undefined),
    } as never);
    mockedGetUserFromToken.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=legacy-auth-token',
      },
      body: JSON.stringify({
        employeeId: 10,
        bankAccount: '1234567890123',
      }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
  });

  it('rejects PUT requests when employeeId is not a positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'oops',
        bankAccount: '1234567890123',
      }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '員工ID格式無效' });
    expect(mockedPrisma.employee.update).not.toHaveBeenCalled();
  });

  it('rejects PUT requests with invalid id-number checksums', async () => {
    mockedValidateTaiwanIdNumber.mockReturnValue(false);

    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 10,
        idNumber: 'A123456789',
      }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '身分證字號格式不正確（檢查碼錯誤）' });
    expect(mockedPrisma.employee.update).not.toHaveBeenCalled();
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        records: [
          {
            name: '王小明',
            bankAccount: '1234567890123',
          },
        ],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.successCount).toBe(1);
    expect(mockedPrisma.employee.findMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('rejects POST requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });
    mockedCookies.mockResolvedValue({
      get: jest.fn().mockImplementation((key: string) => key === 'auth-token'
        ? { value: 'legacy-auth-token' }
        : undefined),
    } as never);
    mockedGetUserFromToken.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=legacy-auth-token',
      },
      body: JSON.stringify({
        records: [
          {
            name: '王小明',
            bankAccount: '1234567890123',
          },
        ],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
  });

  it('rejects POST requests with malformed JSON bodies', async () => {
    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
      body: '{',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請求內容格式無效' });
  });

  it('counts invalid short bank accounts as import errors instead of successes', async () => {
    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        records: [
          {
            name: '王小明',
            bankAccount: '12345',
          },
        ],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.successCount).toBe(0);
    expect(data.errorCount).toBe(1);
    expect(data.errors).toEqual([
      { name: '王小明', error: '銀行帳號格式不正確（應為10-16位數字）' },
    ]);
    expect(mockedPrisma.employee.update).not.toHaveBeenCalled();
  });

  it('counts invalid id numbers without bank accounts as import errors instead of silently skipping them', async () => {
    const request = new NextRequest('http://localhost:3000/api/employees/bank-accounts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        records: [
          {
            name: '王小明',
            idNumber: 'BAD-ID',
          },
        ],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.successCount).toBe(0);
    expect(data.errorCount).toBe(1);
    expect(data.errors).toEqual([
      { name: '王小明', error: '身分證字號格式不正確（應為1個英文字母加9個數字）' },
    ]);
    expect(mockedPrisma.employee.update).not.toHaveBeenCalled();
  });
});
