import { NextRequest } from 'next/server';
import { POST } from '@/app/api/schedules/copy/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import {
  getManageableDepartments,
  hasFullScheduleManagementAccess,
} from '@/lib/schedule-management-permissions';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';

jest.mock('@/lib/database', () => ({
  prisma: {
    schedule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
  hasFullScheduleManagementAccess: jest.fn(),
}));

jest.mock('@/lib/schedule-confirm-service', () => ({
  invalidateConfirmation: jest.fn(),
}));

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn().mockResolvedValue({ isFrozen: false }),
  checkMultipleDatesFreeze: jest.fn().mockResolvedValue(null),
  getAttendanceFreezeError: jest.fn().mockReturnValue(null),
}));

jest.mock('@/lib/shift-definition-service', () => ({
  listShiftDefinitions: jest.fn().mockResolvedValue([]),
}));

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockHasFullScheduleManagementAccess = hasFullScheduleManagementAccess as jest.MockedFunction<typeof hasFullScheduleManagementAccess>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockInvalidateConfirmation = invalidateConfirmation as jest.MockedFunction<typeof invalidateConfirmation>;

describe('schedule copy authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockGetManageableDepartments.mockResolvedValue([]);
    mockInvalidateConfirmation.mockResolvedValue({ invalidated: false } as never);
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/schedules/copy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sourceType: 'week', sourceDate: '2025-01-01', targetDate: '2025-01-08' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
  });

  it('rejects malformed employeeIds before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      role: 'ADMIN',
      username: 'admin',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/schedules/copy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sourceType: 'week',
        sourceDate: '2025-01-01',
        targetDate: '2025-01-08',
        employeeIds: ['1abc'],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeIds 格式錯誤');
  });

  it('rejects malformed JSON bodies before evaluating copy payload', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      role: 'ADMIN',
      username: 'admin',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/schedules/copy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"sourceType":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.update).not.toHaveBeenCalled();
  });

  it('allows schedule permission users and scopes copy lookup to manageable departments', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 22,
      employeeId: 12,
      role: 'EMPLOYEE',
      username: 'huang',
    } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(false);
    mockGetManageableDepartments.mockResolvedValue(['溪北輔具中心']);
    mockPrisma.schedule.findMany.mockResolvedValue([]);

    const request = new NextRequest('http://localhost:3000/api/schedules/copy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sourceType: 'month',
        sourceDate: '2026-05-01',
        targetDate: '2026-05-31',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('來源期間沒有班表記錄');
    expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith({
      where: {
        employee: {
          is: {
            department: { in: ['溪北輔具中心'] },
          },
        },
        workDate: {
          gte: '2026-05-01',
          lte: '2026-05-31',
        },
      },
    });
  });

  it('invalidates confirmation for copied target schedules', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([{
      employeeId: 31,
      workDate: '2026-05-04',
      shiftType: 'B',
      startTime: '08:00',
      endTime: '17:00',
      breakTime: 60,
      workHours: 8,
      specialLeaveHours: 0,
      compLeaveHours: 0,
      overtimeHours: 0,
    }] as never);
    mockPrisma.schedule.findFirst.mockResolvedValue(null as never);
    mockPrisma.schedule.create.mockResolvedValue({ id: 99 } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/schedules/copy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'week',
        sourceDate: '2026-05-04',
        targetDate: '2026-06-01',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(31, '2026-06');
  });
});
