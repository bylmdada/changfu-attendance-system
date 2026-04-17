jest.mock('@/lib/database', () => ({
  prisma: {
    schedule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn()
    },
    employee: {
      findFirst: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/schedule-confirm-service', () => ({
  invalidateConfirmation: jest.fn()
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  canManageScheduleEmployee: jest.fn(),
  getManageableDepartments: jest.fn(),
  hasFullScheduleManagementAccess: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { invalidateConfirmation } from '@/lib/schedule-confirm-service';
import {
  canManageScheduleEmployee,
  getManageableDepartments,
  hasFullScheduleManagementAccess
} from '@/lib/schedule-management-permissions';
import { DELETE, GET, POST, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockInvalidateConfirmation = invalidateConfirmation as jest.MockedFunction<typeof invalidateConfirmation>;
const mockCanManageScheduleEmployee = canManageScheduleEmployee as jest.MockedFunction<typeof canManageScheduleEmployee>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockHasFullScheduleManagementAccess = hasFullScheduleManagementAccess as jest.MockedFunction<typeof hasFullScheduleManagementAccess>;

describe('schedules route regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 10,
      role: 'MANAGER',
      employeeId: 99
    } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(false);
    mockGetManageableDepartments.mockResolvedValue(['護理部'] as never);
    mockCanManageScheduleEmployee.mockResolvedValue(true as never);
    mockInvalidateConfirmation.mockResolvedValue({ invalidated: false } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findUnique.mockResolvedValue(null as never);
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 1,
      employeeId: 'E001',
      department: '護理部'
    } as never);
    mockPrisma.schedule.create.mockResolvedValue({
      id: 123,
      employeeId: 1,
      workDate: '2026-04-05',
      startTime: '09:00',
      endTime: '18:00',
      breakTime: 60,
      shiftType: 'normal',
      employee: {
        employeeId: 'E001',
        name: '王小明',
        department: '護理部'
      }
    } as never);
  });

  it('uses Prisma relation filters with is-clause for manageable departments', async () => {
    const request = new NextRequest('http://localhost/api/schedules?year=2026&month=4');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employee: {
            is: {
              department: {
                in: ['護理部']
              }
            }
          }
        })
      })
    );
  });

  it('accepts workDate alias when creating schedules and invalidates the correct month', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 1,
        workDate: '2026-04-05',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
        shiftType: 'normal'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.schedule.breakTime).toBe(60);
    expect(mockPrisma.schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          breakTime: 60,
        })
      })
    );
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(1, '2026-04');
  });

  it('rejects null request bodies before destructuring schedule creation payload', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: 'null',
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的排程資料');
    expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating schedule creation payload fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: '{"employeeId":',
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
  });

  it('rejects malformed employeeId filters before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockGetManageableDepartments.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/schedules?employeeId=10abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeId 格式錯誤');
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed year/month filters before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockGetManageableDepartments.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/schedules?year=2026&month=4abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('year/month 格式錯誤');
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
  });

  it('rejects malformed schedule ids on PUT before reading the schedule', async () => {
    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ id: '12abc', shiftType: 'A' })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('排程ID格式錯誤');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring schedule update payload', async () => {
    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: 'null'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的排程資料');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating schedule update payload fields', async () => {
    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"id":'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
  });

  it('rejects DELETE when csrf validation fails before reading the schedule', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 9,
      employeeId: 31,
      username: 'scheduler',
      role: 'ADMIN'
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 12,
      employeeId: 31,
      workDate: '2026-05-08',
      employee: {
        id: 31,
        department: '行政部'
      }
    } as never);

    const request = new NextRequest('http://localhost/api/schedules?id=12', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.delete).not.toHaveBeenCalled();
  });

  it('rejects malformed schedule ids on DELETE before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 9,
      employeeId: 31,
      username: 'scheduler',
      role: 'ADMIN'
    } as never);

    const request = new NextRequest('http://localhost/api/schedules?id=12abc', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('排程ID格式錯誤');
    expect(mockPrisma.schedule.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.delete).not.toHaveBeenCalled();
  });
});
