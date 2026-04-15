import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/leave-requests/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { validateLeaveRequest } from '@/lib/leave-rules-validator';
import { createApprovalForRequest } from '@/lib/approval-helper';

jest.mock('@/lib/database', () => ({
  prisma: {
    leaveRequest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    departmentManager: {
      findMany: jest.fn(),
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

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn(),
}));

jest.mock('@/lib/leave-rules-validator', () => ({
  validateLeaveRequest: jest.fn(),
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;
const mockValidateLeaveRequest = validateLeaveRequest as jest.MockedFunction<typeof validateLeaveRequest>;
const mockCreateApprovalForRequest = createApprovalForRequest as jest.MockedFunction<typeof createApprovalForRequest>;

describe('leave request list guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockCheckAttendanceFreeze.mockResolvedValue({ isFrozen: false } as never);
    mockValidateLeaveRequest.mockResolvedValue({ valid: true } as never);
    mockCreateApprovalForRequest.mockResolvedValue(undefined as never);
  });

  it('rejects malformed employeeId filters before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests?employeeId=10abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeId 格式錯誤');
    expect(mockPrisma.leaveRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring leave request payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的請假申請資料');
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating leave request payload fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"leaveType":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });
});