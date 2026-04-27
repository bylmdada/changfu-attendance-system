import { NextRequest } from 'next/server';
import { POST } from '@/app/api/shift-exchange-requests/[id]/void/route';
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
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('shift exchange void authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma));
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/void', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'admin void' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed ids before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/abc/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'admin void' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('調班申請 ID 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的調班作廢資料');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
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

  it('restores swapped schedules in a transaction when voiding an approved exchange', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 5,
      requesterId: 10,
      targetEmployeeId: 11,
      status: 'APPROVED',
      originalWorkDate: '2026-04-01',
      targetWorkDate: '2026-04-02',
      requestReason: JSON.stringify({ type: 'SELF_CHANGE', original: 'A', new: 'B' }),
    } as never);

    mockPrisma.schedule.findFirst
      .mockResolvedValueOnce({ id: 101, shiftType: 'B', startTime: '08:00', endTime: '17:00' } as never);
    mockPrisma.shiftExchangeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchange-requests/5/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'admin void' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.schedule.update).toHaveBeenNthCalledWith(1, {
      where: { id: 101 },
      data: { shiftType: 'A', startTime: '07:30', endTime: '16:30' },
    });
  });
});
