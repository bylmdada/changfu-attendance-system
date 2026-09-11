jest.mock('@/lib/database', () => ({
  prisma: {
    $transaction: jest.fn(),
    schedule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn()
    },
    employee: {
      findFirst: jest.fn(),
      findMany: jest.fn()
    },
    shiftDefinition: {
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

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn().mockResolvedValue({ isFrozen: false }),
  checkMultipleDatesFreeze: jest.fn().mockResolvedValue(null),
  getAttendanceFreezeError: jest.fn().mockReturnValue(null),
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
    mockPrisma.$transaction.mockImplementation((async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma)) as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findUnique.mockResolvedValue(null as never);
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 1,
      employeeId: 'E001',
      name: '王小明',
      department: '護理部'
    } as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'E001',
        name: '王小明',
        department: '護理部',
        isActive: true,
      }
    ] as never);
    mockPrisma.schedule.create.mockResolvedValue({
      id: 123,
      employeeId: 1,
      workDate: '2026-04-05',
      startTime: '09:00',
      endTime: '18:00',
      breakTime: 60,
      workHours: 8,
      specialLeaveHours: 0,
      compLeaveHours: 0,
      overtimeHours: 0,
      shiftType: 'normal',
      employee: {
        employeeId: 'E001',
        name: '王小明',
        department: '護理部'
      }
    } as never);
    mockPrisma.schedule.createMany.mockResolvedValue({ count: 3 } as never);
    mockPrisma.schedule.updateMany.mockResolvedValue({ count: 2 } as never);
    mockPrisma.schedule.deleteMany.mockResolvedValue({ count: 2 } as never);
    mockPrisma.shiftDefinition.findFirst.mockImplementation(async (args?: { where?: { code?: string } }) => {
      const code = args?.where?.code ?? 'A';
      const isOff = code === 'OFF';
      return {
        id: isOff ? 8 : 1,
        code,
        name: code,
        startTime: isOff ? '' : '09:00',
        endTime: isOff ? '' : '18:00',
        breakTime: isOff ? 0 : 60,
        workHours: isOff ? 0 : 8,
        specialLeaveHours: 0,
        compLeaveHours: isOff ? 8 : 0,
        overtimeHours: 0,
        requiresTime: !isOff,
        isActive: true,
        sortOrder: 1,
        description: null,
      };
    });
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

  it('returns schedules with workDate and numeric employeeId so the calendar page can group data correctly', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        id: 201,
        employeeId: 1,
        workDate: '2026-04-05',
        startTime: '07:30',
        endTime: '16:30',
        breakTime: 60,
        shiftType: 'A',
        employee: {
          id: 1,
          employeeId: 'E001',
          name: '王小明',
          department: '護理部',
          position: 'Staff',
        }
      }
    ] as never);

    const response = await GET(new NextRequest('http://localhost/api/schedules?year=2026&month=4'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.schedules[0]).toEqual(expect.objectContaining({
      employeeId: 1,
      employeeCode: 'E001',
      workDate: '2026-04-05',
      date: '2026-04-05',
      shiftType: 'A',
    }));
  });

  it('accepts workDate alias when creating schedules and invalidates the correct month', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 1,
        workDate: '2026-04-05',
        startTime: '06:00',
        endTime: '15:00',
        breakTime: 15,
        workHours: 5,
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
    expect(payload.schedule.startTime).toBe('09:00');
    expect(payload.schedule.endTime).toBe('18:00');
    expect(payload.schedule.workHours).toBe(8);
    expect(mockPrisma.schedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startTime: '09:00',
          endTime: '18:00',
          breakTime: 60,
          workHours: 8,
        })
      })
    );
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(1, '2026-04');
  });

  it('creates multiple schedules from workDates and invalidates each affected month', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 1,
        workDates: ['2026-04-05', '2026-04-06', '2026-05-01'],
        startTime: '06:00',
        endTime: '15:00',
        breakTime: 15,
        workHours: 5,
        shiftType: 'normal'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      createdCount: 3,
      workDates: ['2026-04-05', '2026-04-06', '2026-05-01'],
    }));
    expect(mockPrisma.schedule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ workDate: '2026-04-05', startTime: '09:00', endTime: '18:00', breakTime: 60, workHours: 8 }),
          expect.objectContaining({ workDate: '2026-05-01', startTime: '09:00', endTime: '18:00', breakTime: 60, workHours: 8 }),
        ])
      })
    );
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(1, '2026-04');
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(1, '2026-05');
  });

  it('creates schedules for multiple active employees and multiple workDates in one request', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'E001',
        name: '王小明',
        department: '護理部',
        isActive: true,
      },
      {
        id: 2,
        employeeId: 'E002',
        name: '李小華',
        department: '護理部',
        isActive: true,
      }
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.createMany.mockResolvedValue({ count: 4 } as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeIds: [1, 2],
        workDates: ['2026-04-05', '2026-04-06'],
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
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      createdCount: 4,
      employeeCount: 2,
      workDates: ['2026-04-05', '2026-04-06'],
    }));
    expect(mockPrisma.schedule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ employeeId: 1, workDate: '2026-04-05' }),
          expect.objectContaining({ employeeId: 1, workDate: '2026-04-06' }),
          expect.objectContaining({ employeeId: 2, workDate: '2026-04-05' }),
          expect.objectContaining({ employeeId: 2, workDate: '2026-04-06' }),
        ])
      })
    );
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(1, '2026-04');
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(2, '2026-04');
  });

  it('rejects bulk schedule creation outside manageable departments before writing schedules', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 22, role: 'EMPLOYEE', employeeId: 12 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(false);
    mockGetManageableDepartments.mockResolvedValue(['溪北輔具中心'] as never);
    mockCanManageScheduleEmployee.mockResolvedValue(false as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 8,
        employeeId: '2026000008',
        name: '外部員工',
        department: '資訊部',
        isActive: true,
      }
    ] as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeIds: [8],
        workDates: ['2026-06-24'],
        shiftType: 'normal'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({
      success: false,
      error: '無權限管理員工 外部員工（2026000008，部門：資訊部）的排程；目前可管理部門：溪北輔具中心',
    });
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.createMany).not.toHaveBeenCalled();
  });

  it('updates existing schedules and creates missing schedules during bulk shift assignment', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'E001',
        name: '王小明',
        department: '護理部',
        isActive: true,
      },
      {
        id: 2,
        employeeId: 'E002',
        name: '李小華',
        department: '護理部',
        isActive: true,
      }
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate: '2026-04-05',
        employee: {
          employeeId: 'E001',
          name: '王小明',
        }
      }
    ] as never);
    mockPrisma.schedule.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.schedule.createMany.mockResolvedValue({ count: 3 } as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeIds: [1, 2],
        workDates: ['2026-04-05', '2026-04-06'],
        shiftType: 'normal'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      createdCount: 3,
      updatedCount: 1,
      appliedCount: 4,
      employeeCount: 2,
    }));
    expect(mockPrisma.schedule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employeeId: { in: [1, 2] },
          workDate: { in: ['2026-04-05', '2026-04-06'] },
        }),
        data: expect.objectContaining({
          shiftType: 'normal',
          startTime: '09:00',
          endTime: '18:00',
          breakTime: 60,
          workHours: 8,
        })
      })
    );
    expect(mockPrisma.schedule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ employeeId: 1, workDate: '2026-04-06' }),
          expect.objectContaining({ employeeId: 2, workDate: '2026-04-05' }),
          expect.objectContaining({ employeeId: 2, workDate: '2026-04-06' }),
        ])
      })
    );
  });

  it('previews bulk schedule conflicts without writing schedules when dryRun is true', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'E001',
        name: '王小明',
        department: '護理部',
        isActive: true,
      },
      {
        id: 2,
        employeeId: 'E002',
        name: '李小華',
        department: '護理部',
        isActive: true,
      }
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate: '2026-04-05',
        shiftType: 'A',
        employee: {
          employeeId: 'E001',
          name: '王小明',
        }
      }
    ] as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeIds: [1, 2],
        workDates: ['2026-04-05', '2026-04-06'],
        shiftType: 'OFF',
        dryRun: true,
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      dryRun: true,
      createdCount: 3,
      updatedCount: 1,
      appliedCount: 4,
      employeeCount: 2,
    }));
    expect(payload.conflicts).toEqual([
      {
        employeeId: 1,
        employeeCode: 'E001',
        employeeName: '王小明',
        workDate: '2026-04-05',
        oldShiftType: 'A',
        newShiftType: 'OFF',
      }
    ]);
    expect(mockPrisma.schedule.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.createMany).not.toHaveBeenCalled();
    expect(mockInvalidateConfirmation).not.toHaveBeenCalled();
  });

  it('creates and updates multiple dates with per-day shift entries in one request', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'E001',
        name: '王小明',
        department: '護理部',
        isActive: true,
      },
      {
        id: 2,
        employeeId: 'E002',
        name: '李小華',
        department: '護理部',
        isActive: true,
      }
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 1,
        workDate: '2026-04-05',
        employee: {
          employeeId: 'E001',
          name: '王小明',
        }
      },
      {
        employeeId: 2,
        workDate: '2026-04-06',
        employee: {
          employeeId: 'E002',
          name: '李小華',
        }
      }
    ] as never);
    mockPrisma.schedule.updateMany
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    mockPrisma.schedule.createMany.mockResolvedValue({ count: 2 } as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeIds: [1, 2],
        entries: [
          { workDate: '2026-04-05', shiftType: 'A' },
          { workDate: '2026-04-06', shiftType: 'OFF' },
        ],
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      createdCount: 2,
      updatedCount: 2,
      appliedCount: 4,
      workDates: ['2026-04-05', '2026-04-06'],
    }));
    expect(mockPrisma.schedule.updateMany).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        where: expect.objectContaining({
          employeeId: { in: [1, 2] },
          workDate: { in: ['2026-04-05'] },
        }),
        data: expect.objectContaining({
          shiftType: 'A',
          startTime: '09:00',
          endTime: '18:00',
          breakTime: 60,
          workHours: 8,
        }),
      })
    );
    expect(mockPrisma.schedule.updateMany).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        where: expect.objectContaining({
          employeeId: { in: [1, 2] },
          workDate: { in: ['2026-04-06'] },
        }),
        data: expect.objectContaining({
          shiftType: 'OFF',
          startTime: '',
          endTime: '',
          breakTime: 0,
          compLeaveHours: 8,
        }),
      })
    );
    expect(mockPrisma.schedule.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ employeeId: 1, workDate: '2026-04-06', shiftType: 'OFF', compLeaveHours: 8 }),
          expect.objectContaining({ employeeId: 2, workDate: '2026-04-05', shiftType: 'A', startTime: '09:00', endTime: '18:00' }),
        ])
      })
    );
  });

  it('creates missing dates when bulk-updating one employee schedule entries', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 202, role: 'EMPLOYEE', employeeId: 20 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(false);
    mockCanManageScheduleEmployee.mockResolvedValue(true as never);
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 16,
      employeeId: '2025123016',
      department: '資訊部',
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        id: 801,
        workDate: '2026-06-01',
        shiftType: 'A',
      },
    ] as never);
    mockPrisma.schedule.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.schedule.createMany.mockResolvedValue({ count: 2 } as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'PUT',
      body: JSON.stringify({
        employeeId: 16,
        entries: [
          { workDate: '2026-06-01', shiftType: 'B' },
          { workDate: '2026-06-02', shiftType: 'B' },
          { workDate: '2026-06-03', shiftType: 'OFF' },
        ],
      }),
      headers: {
        'content-type': 'application/json',
      },
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      updatedCount: 1,
      createdCount: 2,
      appliedCount: 3,
      missingDates: [],
      createdDates: ['2026-06-02', '2026-06-03'],
    }));
    expect(mockCanManageScheduleEmployee).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 20 }),
      16,
      expect.any(Date),
      mockPrisma
    );
    expect(mockPrisma.schedule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [801] } },
        data: expect.objectContaining({
          shiftType: 'B',
          startTime: '09:00',
          endTime: '18:00',
          workHours: 8,
        }),
      })
    );
    expect(mockPrisma.schedule.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          employeeId: 16,
          workDate: '2026-06-02',
          shiftType: 'B',
          startTime: '09:00',
          endTime: '18:00',
          workHours: 8,
        }),
        expect.objectContaining({
          employeeId: 16,
          workDate: '2026-06-03',
          shiftType: 'OFF',
          startTime: '',
          endTime: '',
          breakTime: 0,
          compLeaveHours: 8,
        }),
      ]),
    });
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(16, '2026-06');
  });

  it('rejects bulk creation when some employees are inactive', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'E001',
        name: '王小明',
        department: '護理部',
        isActive: true,
      },
      {
        id: 2,
        employeeId: 'E099',
        name: '陳測試',
        department: '護理部',
        isActive: false,
      }
    ] as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        employeeIds: [1, 2],
        workDates: ['2026-04-05'],
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

    expect(response.status).toBe(404);
    expect(payload.error).toContain('以下員工不存在或已停用');
    expect(mockPrisma.schedule.createMany).not.toHaveBeenCalled();
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

  it('preserves existing schedule hour fields when resubmitting the same shift type', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 12,
      employeeId: 1,
      shiftType: 'OFF',
      workDate: '2026-05-02',
      employee: {
        id: 1,
        department: '護理部',
      },
    } as never);
    mockPrisma.schedule.update.mockResolvedValue({
      id: 12,
      employeeId: 1,
      shiftType: 'OFF',
      workDate: '2026-05-03',
      startTime: '',
      endTime: '',
      breakTime: 0,
      workHours: 0,
      specialLeaveHours: 0,
      compLeaveHours: 8,
      overtimeHours: 0,
      employee: {
        employeeId: 'E001',
        name: '王小明',
        department: '護理部',
      },
    } as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 12, shiftType: 'OFF' }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { shiftType: 'OFF' },
      })
    );
  });

  it('rejects manual work hours that contradict the time range and break', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 12,
      employeeId: 1,
      shiftType: 'B',
      workDate: '2026-05-02',
      startTime: '09:00',
      endTime: '18:00',
      breakTime: 60,
      workHours: 8,
      employee: { id: 1, department: '護理部' },
    } as never);

    const response = await PUT(new NextRequest('http://localhost/api/schedules', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 12, workHours: 4 }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('工時與上下班時間、休息時間不一致');
    expect(mockPrisma.schedule.update).not.toHaveBeenCalled();
  });

  it('updates multiple existing schedules for the same employee when workDates are provided', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 1,
      employeeId: 'E001',
      department: '護理部',
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { id: 21, workDate: '2026-05-05', shiftType: 'A' },
      { id: 22, workDate: '2026-05-06', shiftType: 'A' },
    ] as never);
    mockPrisma.schedule.createMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        employeeId: 1,
        workDates: ['2026-05-05', '2026-05-06', '2026-05-07'],
        shiftType: 'OFF',
        startTime: '',
        endTime: '',
        breakTime: 0,
        workHours: 0,
        specialLeaveHours: 0,
        compLeaveHours: 8,
        overtimeHours: 0,
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      updatedCount: 2,
      createdCount: 1,
      appliedCount: 3,
      createdDates: ['2026-05-07'],
      missingDates: [],
    }));
    expect(mockPrisma.schedule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [21, 22] } },
        data: expect.objectContaining({
          shiftType: 'OFF',
          compLeaveHours: 8,
        }),
      })
    );
    expect(mockPrisma.schedule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          employeeId: 1,
          workDate: '2026-05-07',
          shiftType: 'OFF',
          compLeaveHours: 8,
        }),
      ],
    });
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(1, '2026-05');
  });

  it('updates multiple existing schedules with per-day shift entries and creates missing dates', async () => {
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN', employeeId: 1 } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 1,
      employeeId: 'E001',
      department: '護理部',
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { id: 21, workDate: '2026-05-05', shiftType: 'A' },
      { id: 22, workDate: '2026-05-06', shiftType: 'A' },
    ] as never);
    mockPrisma.schedule.updateMany
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    mockPrisma.schedule.createMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        employeeId: 1,
        entries: [
          { workDate: '2026-05-05', shiftType: 'A' },
          { workDate: '2026-05-06', shiftType: 'OFF' },
          { workDate: '2026-05-07', shiftType: 'A' },
        ],
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      updatedCount: 2,
      createdCount: 1,
      appliedCount: 3,
      createdDates: ['2026-05-07'],
      missingDates: [],
    }));
    expect(mockPrisma.schedule.updateMany).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        where: { id: { in: [21] } },
        data: expect.objectContaining({
          shiftType: 'A',
          startTime: '09:00',
          endTime: '18:00',
        }),
      })
    );
    expect(mockPrisma.schedule.updateMany).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        where: { id: { in: [22] } },
        data: expect.objectContaining({
          shiftType: 'OFF',
          startTime: '',
          endTime: '',
          compLeaveHours: 8,
        }),
      })
    );
    expect(mockPrisma.schedule.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          employeeId: 1,
          workDate: '2026-05-07',
          shiftType: 'A',
          startTime: '09:00',
          endTime: '18:00',
        }),
      ],
    });
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

  it('deletes multiple schedules for selected employees and workDates in one request', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN'
    } as never);
    mockHasFullScheduleManagementAccess.mockReturnValue(true);
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'E001',
        name: '王小明',
        department: '護理部',
      },
      {
        id: 2,
        employeeId: 'E002',
        name: '李小華',
        department: '護理部',
      }
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      { id: 51, employeeId: 1, workDate: '2026-07-01' },
      { id: 52, employeeId: 1, workDate: '2026-07-02' },
      { id: 53, employeeId: 2, workDate: '2026-07-01' },
    ] as never);
    mockPrisma.schedule.deleteMany.mockResolvedValue({ count: 3 } as never);

    const request = new NextRequest('http://localhost/api/schedules', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        employeeIds: [1, 2],
        workDates: ['2026-07-01', '2026-07-02'],
      })
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      deletedCount: 3,
      employeeCount: 2,
      workDates: ['2026-07-01', '2026-07-02'],
    }));
    expect(mockPrisma.schedule.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: [51, 52, 53] }
      }
    });
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(1, '2026-07');
    expect(mockInvalidateConfirmation).toHaveBeenCalledWith(2, '2026-07');
  });
});
