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
    user: {
      updateMany: jest.fn(),
    },
    handoverItem: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
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
    mockPrisma.handoverItem.count.mockResolvedValue(0 as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      resignationRecord: mockPrisma.resignationRecord,
      employee: mockPrisma.employee,
      user: mockPrisma.user,
    } as never) as never);
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
    mockPrisma.resignationRecord.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'IN_HANDOVER',
    } as never);

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

  it('returns 400 when an admin tries to approve a non-pending resignation', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'approve',
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('只有待審核的申請可以核准，目前狀態為 APPROVED');
    expect(mockPrisma.resignationRecord.update).not.toHaveBeenCalled();
  });

  it('returns 400 when complete action still has unfinished handover items', async () => {
    mockPrisma.resignationRecord.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'IN_HANDOVER',
    } as never);
    mockPrisma.handoverItem.count.mockResolvedValue(2 as never);

    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'complete',
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('尚有未完成的交接項目，無法完成離職');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('completes resignation atomically and disables both employee and login account', async () => {
    mockPrisma.resignationRecord.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'IN_HANDOVER',
    } as never);
    mockPrisma.resignationRecord.update.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'COMPLETED',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: 'Test User',
      }
    } as never);
    mockPrisma.employee.update.mockResolvedValue({ id: 10, isActive: false } as never);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'complete',
        actualDate: '2026-05-01',
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toBe('離職流程已完成，員工與登入帳號已停用');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.employee.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { isActive: false }
    });
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 10 },
      data: {
        isActive: false,
        currentSessionId: null
      }
    });
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
