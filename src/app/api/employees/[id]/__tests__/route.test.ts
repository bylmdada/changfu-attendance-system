jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
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
    $transaction: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { GET, PUT, DELETE } from '@/app/api/employees/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

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
      user: { id: 50, username: 'wang', role: 'EMPLOYEE', isActive: true },
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      employee: {
        update: jest.fn().mockResolvedValue({ id: 10, employeeId: 'E010', name: '王小明', isActive: true }),
      },
      user: {
        update: jest.fn().mockResolvedValue({ id: 50 }),
        create: jest.fn().mockResolvedValue({ id: 50 }),
        findFirst: jest.fn().mockResolvedValue(null),
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
});