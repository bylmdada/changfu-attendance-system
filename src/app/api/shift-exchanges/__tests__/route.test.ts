import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/shift-exchanges/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { findActiveShiftDefinition } from '@/lib/shift-definition-service';

jest.mock('@/lib/database', () => ({
  prisma: {
    shiftExchangeRequest: {
      findMany: jest.fn(),
      create: jest.fn(),
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

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn(),
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

jest.mock('@/lib/shift-definition-service', () => ({
  findActiveShiftDefinition: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;
const mockCreateApprovalForRequest = createApprovalForRequest as jest.MockedFunction<typeof createApprovalForRequest>;
const mockFindActiveShiftDefinition = findActiveShiftDefinition as jest.MockedFunction<typeof findActiveShiftDefinition>;

describe('shift exchanges route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockCheckAttendanceFreeze.mockResolvedValue({ isFrozen: false } as never);
    mockCreateApprovalForRequest.mockResolvedValue(undefined as never);
    mockFindActiveShiftDefinition.mockResolvedValue({ code: 'B' } as never);
  });

  it('rejects malformed requesterId on GET before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges?requesterId=10abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('requesterId 格式錯誤');
    expect(mockPrisma.shiftExchangeRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects incomplete self-change payloads on POST before creating the request', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        shiftDate: '2026-04-01',
        originalShiftType: 'A',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('調班日期、原班別、新班別與申請原因為必填');
    expect(mockPrisma.shiftExchangeRequest.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });

  it('rejects null request bodies on POST before creating the request', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges', {
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
    expect(mockPrisma.shiftExchangeRequest.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies on POST before creating the request', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/shift-exchanges', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"shiftDate":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.shiftExchangeRequest.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });

  it('stores shift data in dedicated fields and keeps the reason as plain text', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);
    mockPrisma.shiftExchangeRequest.create.mockResolvedValue({
      id: 1,
      requesterId: 10,
      targetEmployeeId: 10,
      originalWorkDate: '2026-07-09',
      targetWorkDate: '2026-07-09',
      requestReason: '家庭需求',
      originalShiftType: 'A',
      newShiftType: 'B',
      leaveType: null,
      status: 'PENDING',
      createdAt: new Date('2026-07-09T00:00:00Z'),
      requester: { id: 10, employeeId: 'E010', name: '測試員工', department: '測試部', position: '職員' },
      targetEmployee: { id: 10, employeeId: 'E010', name: '測試員工', department: '測試部', position: '職員' },
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/shift-exchanges', {
      method: 'POST',
      headers: { cookie: 'token=session-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        shiftDate: '2026-07-09',
        originalShiftType: 'A',
        newShiftType: 'B',
        reason: '家庭需求',
      }),
    }));

    expect(response.status).toBe(201);
    expect(mockPrisma.shiftExchangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestReason: '家庭需求',
        originalShiftType: 'A',
        newShiftType: 'B',
        leaveType: null,
      }),
    }));
  });
});
