import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { DELETE, GET, PUT } from '@/app/api/resignation/[id]/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    resignationRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employee: {
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('resignation detail route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.resignationRecord.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'APPROVED',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: 'Test User',
        department: 'HR',
        position: 'Manager',
        hireDate: new Date('2020-01-01'),
      },
      handoverItems: [],
    } as never);
  });

  it('returns 400 when route id is not a strict positive integer on GET', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5abc');

    const response = await GET(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('離職申請ID格式無效');
    expect(mockPrisma.resignationRecord.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT body JSON is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"action":"approve"',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.resignationRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.resignationRecord.update).not.toHaveBeenCalled();
  });

  it('returns 400 when complete action uses an invalid actualDate', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'complete',
        actualDate: 'not-a-date',
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('實際離職日格式無效');
    expect(mockPrisma.resignationRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.employee.update).not.toHaveBeenCalled();
  });

  it('returns 400 when route id is not a strict positive integer on DELETE', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('離職申請ID格式無效');
    expect(mockPrisma.resignationRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.resignationRecord.delete).not.toHaveBeenCalled();
  });
});