const mockPrisma = {
  departmentManager: {
    findMany: jest.fn()
  },
  managerDeputy: {
    findMany: jest.fn()
  },
  attendancePermission: {
    findUnique: jest.fn()
  },
  employee: {
    findUnique: jest.fn()
  }
};

jest.mock('@/lib/database', () => ({
  prisma: mockPrisma
}));

import {
  buildActiveDeputyAssignmentWhere,
  canManageScheduleEmployee,
  getManageableDepartments,
  hasFullScheduleManagementAccess
} from '@/lib/schedule-management-permissions';

describe('schedule management permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty scope for full admins', async () => {
    await expect(getManageableDepartments({ role: 'ADMIN', employeeId: 1 })).resolves.toEqual([]);
    expect(mockPrisma.departmentManager.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.managerDeputy.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.attendancePermission.findUnique).not.toHaveBeenCalled();
  });

  it('recognizes full schedule access roles', () => {
    expect(hasFullScheduleManagementAccess({ role: 'ADMIN', employeeId: 1 })).toBe(true);
    expect(hasFullScheduleManagementAccess({ role: 'HR', employeeId: 2 })).toBe(true);
    expect(hasFullScheduleManagementAccess({ role: 'USER', employeeId: 3 })).toBe(false);
  });

  it('combines manager, deputy, and permission departments without duplicates', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '資訊部' }
    ]);
    mockPrisma.managerDeputy.findMany.mockResolvedValue([
      { manager: { department: '溪北輔具中心' } },
      { manager: { department: '資訊部' } }
    ]);
    mockPrisma.attendancePermission.findUnique.mockResolvedValue({
      permissions: {
        scheduleManagement: ['羅東失智據點', '資訊部']
      }
    });

    await expect(
      getManageableDepartments({ role: 'USER', employeeId: 99 }, new Date('2026-04-07T00:00:00.000Z'))
    ).resolves.toEqual(['資訊部', '溪北輔具中心', '羅東失智據點']);
  });

  it('builds deputy query with active date window', async () => {
    const now = new Date('2026-04-07T00:00:00.000Z');

    expect(buildActiveDeputyAssignmentWhere(12, now)).toEqual({
      deputyEmployeeId: 12,
      isActive: true,
      AND: [
        {
          OR: [
            { startDate: null },
            { startDate: { lte: now } }
          ]
        },
        {
          OR: [
            { endDate: null },
            { endDate: { gte: now } }
          ]
        }
      ]
    });
  });

  it('allows managing employees inside manageable departments', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '資訊部' }
    ]);
    mockPrisma.managerDeputy.findMany.mockResolvedValue([]);
    mockPrisma.attendancePermission.findUnique.mockResolvedValue(null);
    mockPrisma.employee.findUnique.mockResolvedValue({ department: '資訊部' });

    await expect(
      canManageScheduleEmployee({ role: 'USER', employeeId: 99 }, 123, new Date('2026-04-07T00:00:00.000Z'))
    ).resolves.toBe(true);

    expect(mockPrisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 123 },
      select: { department: true }
    });
  });

  it('rejects managing employees outside manageable departments', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '資訊部' }
    ]);
    mockPrisma.managerDeputy.findMany.mockResolvedValue([]);
    mockPrisma.attendancePermission.findUnique.mockResolvedValue(null);
    mockPrisma.employee.findUnique.mockResolvedValue({ department: '人資部' });

    await expect(
      canManageScheduleEmployee({ role: 'USER', employeeId: 99 }, 456, new Date('2026-04-07T00:00:00.000Z'))
    ).resolves.toBe(false);
  });
});
