import { NextRequest } from 'next/server';
import { DELETE, GET, POST, PUT } from '@/app/api/shift-swap-requests/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    shiftExchangeRequest: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
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

const transactionClient = {
  shiftExchangeRequest: {
    update: jest.fn(),
  },
  schedule: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

describe('shift-swap requests route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient));
  });

  it('rejects malformed employeeId on GET before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests?employeeId=10abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeId 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects null request bodies on POST before touching Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的調班申請資料');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.findFirst).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies on POST before touching Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"targetEmployeeId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.findFirst).not.toHaveBeenCalled();
  });

  it('rejects malformed targetEmployeeId on POST before touching Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetEmployeeId: 'abc',
        originalWorkDate: '2026-04-01',
        targetWorkDate: '2026-04-02',
        requestReason: '互調',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('targetEmployeeId 格式錯誤');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects null request bodies on PUT before touching Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的調班審核資料');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies on PUT before touching Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"id":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on PUT before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'abc',
        status: 'APPROVED',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請ID 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('requires csrf validation on DELETE requests', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: false } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: '5' }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF驗證失敗');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.delete).not.toHaveBeenCalled();
  });

  it('rejects null request bodies on DELETE before touching Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的調班取消資料');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.delete).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies on DELETE before touching Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"id":',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.delete).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on DELETE before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 'abc' }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請ID 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.delete).not.toHaveBeenCalled();
  });

  it('updates approval status and swapped schedules atomically when approving a shift swap', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 5,
      requesterId: 10,
      targetEmployeeId: 11,
      originalWorkDate: '2026-04-01',
      targetWorkDate: '2026-04-02',
      status: 'PENDING',
    } as never);

    transactionClient.shiftExchangeRequest.update.mockResolvedValue({
      id: 5,
      status: 'APPROVED',
    } as never);
    transactionClient.schedule.findFirst
      .mockResolvedValueOnce({ id: 101, shiftType: 'A', startTime: '08:00', endTime: '16:00' } as never)
      .mockResolvedValueOnce({ id: 202, shiftType: 'B', startTime: '16:00', endTime: '00:00' } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-swap-requests', {
      method: 'PUT',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 5, status: 'APPROVED', adminRemarks: 'ok' }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.shiftExchangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ status: 'APPROVED', approvedBy: 1 }),
      })
    );
    expect(transactionClient.schedule.update).toHaveBeenNthCalledWith(1, {
      where: { id: 101 },
      data: { shiftType: 'B', startTime: '16:00', endTime: '00:00' },
    });
    expect(transactionClient.schedule.update).toHaveBeenNthCalledWith(2, {
      where: { id: 202 },
      data: { shiftType: 'A', startTime: '08:00', endTime: '16:00' },
    });
  });
});