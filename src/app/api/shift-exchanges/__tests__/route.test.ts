import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/shift-exchanges/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { createApprovalForRequest } from '@/lib/approval-helper';

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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;
const mockCreateApprovalForRequest = createApprovalForRequest as jest.MockedFunction<typeof createApprovalForRequest>;

describe('shift exchanges route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockCheckAttendanceFreeze.mockResolvedValue({ isFrozen: false } as never);
    mockCreateApprovalForRequest.mockResolvedValue(undefined as never);
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

  it('rejects malformed targetEmployeeId on POST before creating the request', async () => {
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
      body: '{"targetEmployeeId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.shiftExchangeRequest.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });
});