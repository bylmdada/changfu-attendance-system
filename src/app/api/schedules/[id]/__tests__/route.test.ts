jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    $transaction: jest.fn(),
    schedule: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    scheduleMonthlyRelease: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    scheduleConfirmation: {
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  canManageScheduleEmployee: jest.fn(),
  hasFullScheduleManagementAccess: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { canManageScheduleEmployee } from '@/lib/schedule-management-permissions';
import { DELETE, GET, PUT } from '../route';

const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockCanManageScheduleEmployee = canManageScheduleEmployee as jest.MockedFunction<typeof canManageScheduleEmployee>;

describe('schedule item route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 9,
      employeeId: 31,
      username: 'scheduler',
      role: 'ADMIN',
    } as never);
    mockCanManageScheduleEmployee.mockResolvedValue(true as never);
    mockPrisma.$transaction.mockImplementation((async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma)) as never);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      employeeId: 31,
      workDate: '2026-05-08',
    } as never);
  });

  it('rejects DELETE when csrf validation fails before reading the schedule', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/schedules/12', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.delete).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on DELETE before querying Prisma', async () => {
    const request = new NextRequest('http://localhost/api/schedules/12abc', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid schedule ID');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.delete).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on GET before querying Prisma', async () => {
    const request = new NextRequest('http://localhost/api/schedules/12abc', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid schedule ID');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on PUT before querying Prisma', async () => {
    const request = new NextRequest('http://localhost/api/schedules/12abc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({ shiftType: 'A' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid schedule ID');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies on PUT before updating the schedule', async () => {
    const request = new NextRequest('http://localhost/api/schedules/12', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"shiftType":',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.delete).not.toHaveBeenCalled();
  });
});
