import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { DELETE, GET, PUT } from '@/app/api/my-dependents/[id]/route';

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    dependentApplication: {
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('my dependents detail route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'user1',
      role: 'EMPLOYEE',
      sessionId: 'session-1',
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      employee: {
        id: 10,
        name: '王小明',
        department: '行政部',
      },
    } as never);
    mockPrisma.dependentApplication.findFirst.mockResolvedValue(null as never);
  });

  it('returns 400 when GET route id is not a strict positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-dependents/5abc');

    const response = await GET(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請ID格式無效' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.dependentApplication.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT route id is not a strict positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-dependents/5abc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ dependentName: '王小明' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請ID格式無效' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.dependentApplication.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT body JSON is malformed', async () => {
    mockPrisma.dependentApplication.findFirst.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING',
      dependentName: '王小明',
      relationship: 'SPOUSE',
      idNumber: 'A123456789',
      birthDate: new Date('1990-01-01'),
      effectiveDate: new Date('2026-05-01'),
      remarks: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/my-dependents/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"dependentName":"王小明"',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockPrisma.dependentApplication.update).not.toHaveBeenCalled();
  });

  it('returns 400 when DELETE route id is not a strict positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/my-dependents/5abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請ID格式無效' });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.dependentApplication.findFirst).not.toHaveBeenCalled();
  });
});