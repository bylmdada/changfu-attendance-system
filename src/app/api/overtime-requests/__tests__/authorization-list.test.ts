import { NextRequest } from 'next/server';
import { GET } from '@/app/api/overtime-requests/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn(),
}));

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn((value: Date) => value.toISOString().slice(0, 10)),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;

describe('overtime request list authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 8,
      employeeId: 80,
      role: 'MANAGER',
      username: 'manager',
    } as never);
    mockGetManageableDepartments.mockResolvedValue(['製造部'] as never);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([] as never);
  });

  it('limits non-admin overtime list queries to manageable departments', async () => {
    const request = new NextRequest('http://localhost/api/overtime-requests');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.overtimeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employee: {
            department: { in: ['製造部'] },
          },
        }),
      })
    );
  });

  it('rejects malformed employeeId filters before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);

    const request = new NextRequest('http://localhost/api/overtime-requests?employeeId=10abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeId 格式錯誤');
    expect(mockPrisma.overtimeRequest.findMany).not.toHaveBeenCalled();
  });
});