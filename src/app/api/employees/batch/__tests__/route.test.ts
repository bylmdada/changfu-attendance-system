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

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/employees/batch/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, hashPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockHashPassword = hashPassword as jest.MockedFunction<typeof hashPassword>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('employees batch import guards', () => {
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

    mockPrisma.employee.findMany.mockResolvedValue([] as never);
    mockPrisma.user.findMany.mockResolvedValue([] as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.employee.create.mockResolvedValue({ id: 100, employeeId: 'E100', name: '王小明' } as never);
    mockHashPassword.mockResolvedValue('hashed-password' as never);
  });

  it('rejects malformed JSON bodies before starting batch import', async () => {
    const response = await POST(new NextRequest('http://localhost/api/employees/batch', {
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
    expect(mockPrisma.employee.create).not.toHaveBeenCalled();
  });

  it('reports rows with non-numeric salary fields as failures instead of importing them', async () => {
    const response = await POST(new NextRequest('http://localhost/api/employees/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employees: [
          {
            employeeId: 'E100',
            name: '王小明',
            birthday: '1990-01-01',
            hireDate: '2024-01-01',
            baseSalary: 'abc',
            hourlyRate: 250,
            department: '行政部',
            position: '專員',
          },
        ],
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({ total: 1, success: 0, failed: 1 });
    expect(payload.results[0]).toMatchObject({
      success: false,
      employeeId: 'E100',
    });
    expect(mockPrisma.employee.create).not.toHaveBeenCalled();
  });

  it('reports concurrent unique conflicts as row failures instead of leaking raw database errors', async () => {
    const duplicateError = new Error('UNIQUE constraint failed: Employee.employeeId');
    Object.assign(duplicateError, { code: 'P2002' });
    mockPrisma.employee.create.mockRejectedValueOnce(duplicateError as never);

    const response = await POST(new NextRequest('http://localhost/api/employees/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employees: [
          {
            employeeId: 'E100',
            name: '王小明',
            birthday: '1990-01-01',
            hireDate: '2024-01-01',
            baseSalary: 40000,
            hourlyRate: 250,
            department: '行政部',
            position: '專員',
          },
        ],
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({ total: 1, success: 0, failed: 1 });
    expect(payload.results[0]).toMatchObject({
      success: false,
      employeeId: 'E100',
      error: '員工編號或帳號已存在',
    });
  });

  it('returns generated temporary passwords for successful imports instead of the old weak default pattern', async () => {
    const response = await POST(new NextRequest('http://localhost/api/employees/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employees: [
          {
            employeeId: 'E100',
            name: '王小明',
            birthday: '1990-01-01',
            hireDate: '2024-01-01',
            baseSalary: 40000,
            hourlyRate: 250,
            department: '行政部',
            position: '專員',
          },
        ],
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.results[0]).toMatchObject({
      success: true,
      employeeId: 'E100',
      name: '王小明',
      temporaryPassword: expect.any(String),
    });
    expect(payload.results[0].temporaryPassword).toHaveLength(12);
    expect(payload.results[0].temporaryPassword).not.toBe('E100123');
  });
});
