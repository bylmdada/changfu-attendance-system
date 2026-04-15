import { NextRequest } from 'next/server';
import { POST, PUT } from '@/app/api/shift-exchange-requests/[id]/cancel/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    shiftExchangeRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    schedule: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
    departmentManager: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('shift exchange cancellation authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 5,
      requesterId: 10,
      status: 'APPROVED',
      cancellationStatus: 'PENDING_MANAGER',
      requester: {
        department: '製造部',
      },
      targetEmployeeId: 11,
      originalWorkDate: '2026-04-01',
      targetWorkDate: '2026-04-02',
      requestReason: '互調',
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma));
  });

  it('rejects POST when shared request auth cannot resolve a user', async () => {
    mockedGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '我要撤銷' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
  });

  it('rejects manager review when the requester department is outside managed departments', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '人資部' },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('權限');
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('allows manager review when the requester department is managed', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '製造部' },
    ] as never);
    mockPrisma.shiftExchangeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE', note: '同意撤銷' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.shiftExchangeRequest.update).toHaveBeenCalled();
  });

  it('rejects malformed ids on POST before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/abc/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '我要撤銷' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('調班申請 ID 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on PUT before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/abc/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('調班申請 ID 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects null request bodies on POST before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的調班撤銷資料');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies on POST before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"reason":',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects null request bodies on PUT before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的調班撤銷資料');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies on PUT before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: '{"opinion":',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('restores swapped schedules in a transaction when admin approves cancellation', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 5,
      requesterId: 10,
      targetEmployeeId: 11,
      status: 'APPROVED',
      cancellationStatus: 'PENDING_ADMIN',
      originalWorkDate: '2026-04-01',
      targetWorkDate: '2026-04-02',
      requestReason: '互調',
      requester: {
        department: '製造部',
      },
    } as never);

    mockPrisma.schedule.findFirst
      .mockResolvedValueOnce({ id: 101, shiftType: 'B', startTime: '16:00', endTime: '00:00' } as never)
      .mockResolvedValueOnce({ id: 202, shiftType: 'A', startTime: '08:00', endTime: '16:00' } as never);
    mockPrisma.shiftExchangeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'APPROVE', note: '核准撤銷' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.schedule.update).toHaveBeenNthCalledWith(1, {
      where: { id: 101 },
      data: { shiftType: 'A', startTime: '08:00', endTime: '16:00' },
    });
    expect(mockPrisma.schedule.update).toHaveBeenNthCalledWith(2, {
      where: { id: 202 },
      data: { shiftType: 'B', startTime: '16:00', endTime: '00:00' },
    });
  });
});