import { NextRequest } from 'next/server';
import { DELETE, PATCH } from '@/app/api/shift-exchanges/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { canAccessAttendanceDepartment } from '@/lib/attendance-permission-scopes';

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

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn(),
}));

jest.mock('@/lib/attendance-permission-scopes', () => ({
  canAccessAttendanceDepartment: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;
const mockCanAccessAttendanceDepartment = canAccessAttendanceDepartment as jest.MockedFunction<typeof canAccessAttendanceDepartment>;

const transactionClient = {
  shiftExchangeRequest: {
    update: jest.fn(),
  },
  schedule: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

describe('shift exchange authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockCheckAttendanceFreeze.mockResolvedValue({ isFrozen: false } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockCanAccessAttendanceDepartment.mockResolvedValue(false as never);
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 5,
      requesterId: 10,
      targetEmployeeId: 11,
      originalWorkDate: '2026-04-01',
      targetWorkDate: '2026-04-01',
      requestReason: JSON.stringify({ type: 'SELF_CHANGE', shiftDate: '2026-04-01', original: 'A', new: 'B', note: '調班' }),
      status: 'PENDING',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      requester: {
        id: 10,
        department: '製造部',
      },
      targetEmployee: {
        id: 11,
      },
    } as never);
  });

  it('requires csrf validation on PATCH requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF token validation failed');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('requires csrf validation on DELETE requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF token validation failed');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects manager review when the requester department is outside managed departments', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('權限');
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('allows manager review when the requester department is managed', async () => {
    mockCanAccessAttendanceDepartment.mockResolvedValue(true as never);
    mockPrisma.shiftExchangeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE', remarks: '同意調班' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.shiftExchangeRequest.update).toHaveBeenCalled();
  });

  it('allows permission holders to forward shift reviews with APPROVED status payloads', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'USER',
      employeeId: 77,
      userId: 177,
    } as never);
    mockCanAccessAttendanceDepartment.mockResolvedValue(true as never);
    mockPrisma.shiftExchangeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED', remarks: '同意調班' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.shiftExchangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_ADMIN',
          managerReviewerId: 77,
          managerOpinion: 'AGREE',
        }),
      })
    );
  });

  it('rejects malformed ids on PATCH before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/abc', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('調班申請 ID 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on DELETE before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/abc', {
      method: 'DELETE',
      headers: {
        cookie: 'token=session-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('調班申請 ID 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects editing legacy mutual-swap requests when the feature is disabled', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValueOnce({
      id: 5,
      requesterId: 10,
      targetEmployeeId: 11,
      originalWorkDate: '2026-04-01',
      targetWorkDate: '2026-04-02',
      requestReason: '互調',
      status: 'PENDING',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      requester: {
        id: 10,
        department: '製造部',
      },
      targetEmployee: {
        id: 11,
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        shiftDate: '2026-04-01',
        originalShiftType: 'A',
        newShiftType: 'B',
        reason: '改單',
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('員工互調功能已停用，無法修改舊互調申請');
    expect(mockPrisma.shiftExchangeRequest.findUnique).toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects null request bodies on PATCH before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的調班申請資料');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies on PATCH before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"opinion":',
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });

  it('fails admin approvals when the referenced schedules cannot be loaded', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);
    transactionClient.schedule.findFirst.mockResolvedValueOnce(null as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('找不到申請人的班表，無法核准調班申請');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.schedule.update).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
  });
});
