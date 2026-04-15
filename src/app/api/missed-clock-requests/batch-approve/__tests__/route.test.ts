import { NextRequest } from 'next/server';
import { POST } from '@/app/api/missed-clock-requests/batch-approve/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    missedClockRequest: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    departmentManager: {
      findMany: jest.fn(),
    },
    attendanceRecord: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
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
  missedClockRequest: {
    update: jest.fn(),
  },
  attendanceRecord: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

describe('missed clock batch approval authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockPrisma.missedClockRequest.findMany.mockResolvedValue([
      {
        id: 5,
        employeeId: 10,
        employee: {
          department: '製造部',
        },
      },
    ] as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects manager batch review when selected requests are outside managed departments', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '人資部' },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [5], opinion: 'AGREE', remarks: 'batch review' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('權限');
    expect(mockPrisma.missedClockRequest.update).not.toHaveBeenCalled();
  });

  it('rejects manager batch review when every selected request has already been processed', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '製造部' },
    ] as never);
    mockPrisma.missedClockRequest.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [5], opinion: 'AGREE', remarks: 'batch review' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請已被處理');
    expect(payload.failedIds).toEqual([5]);
    expect(mockPrisma.missedClockRequest.update).not.toHaveBeenCalled();
  });

  it('stores employeeId as approvedBy for admin batch approvals', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 10,
      userId: 1,
    } as never);
    mockPrisma.missedClockRequest.findMany.mockResolvedValue([
      {
        id: 5,
        employeeId: 20,
        workDate: new Date('2024-01-01T00:00:00.000Z'),
        clockType: 'CLOCK_IN',
        requestedTime: '09:00',
      },
    ] as never);
    transactionClient.missedClockRequest.update.mockResolvedValue({ id: 5 } as never);
    transactionClient.attendanceRecord.findFirst.mockResolvedValue(null as never);
    transactionClient.attendanceRecord.create.mockResolvedValue({ id: 99 } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [5], action: 'APPROVED', remarks: 'ok' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.missedClockRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.create).not.toHaveBeenCalled();
    expect(transactionClient.missedClockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
    expect(transactionClient.attendanceRecord.create).toHaveBeenCalledWith({
      data: {
        employeeId: 20,
        workDate: new Date('2024-01-01T00:00:00.000Z'),
        status: 'PRESENT',
        clockInTime: '09:00',
      },
    });
  });

  it('rejects final batch approval when every selected request has already been processed', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 10,
      userId: 1,
    } as never);
    mockPrisma.missedClockRequest.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [5], action: 'APPROVED' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請已被處理');
    expect(payload.failedIds).toEqual([5]);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows HR batch approvals and records HR employeeId as approvedBy', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'HR',
      employeeId: 30,
      userId: 3,
    } as never);
    mockPrisma.missedClockRequest.findMany.mockResolvedValue([
      {
        id: 6,
        employeeId: 21,
        workDate: new Date('2024-01-02T00:00:00.000Z'),
        clockType: 'CLOCK_OUT',
        requestedTime: '18:00',
      },
    ] as never);
    transactionClient.missedClockRequest.update.mockResolvedValue({ id: 6 } as never);
    transactionClient.attendanceRecord.findFirst.mockResolvedValue({ id: 100 } as never);
    transactionClient.attendanceRecord.update.mockResolvedValue({ id: 100 } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [6], action: 'APPROVED', remarks: 'hr ok' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.missedClockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 6 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 30,
        }),
      })
    );
    expect(transactionClient.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: {
        clockOutTime: '18:00',
      },
    });
  });

  it('stores rejectReason when admin batch reject submits reason field', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 10,
      userId: 1,
    } as never);
    mockPrisma.missedClockRequest.findMany.mockResolvedValue([
      {
        id: 5,
        employeeId: 20,
        workDate: new Date('2024-01-01T00:00:00.000Z'),
        clockType: 'CLOCK_IN',
        requestedTime: '09:00',
      },
    ] as never);
    mockPrisma.missedClockRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [5], action: 'REJECTED', reason: '資料不完整' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(mockPrisma.missedClockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          status: 'REJECTED',
          approvedBy: 10,
          rejectReason: '資料不完整',
        }),
      })
    );
  });

  it('rejects null request bodies before batch approval parsing', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
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
    expect(payload.error).toBe('請提供有效的批次審核資料');
    expect(mockPrisma.missedClockRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed ids before querying missed clock requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: ['bad-id'], opinion: 'AGREE', remarks: 'batch review' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ids 格式錯誤');
    expect(mockPrisma.missedClockRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before batch approval parsing', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"ids":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.missedClockRequest.findMany).not.toHaveBeenCalled();
  });
});