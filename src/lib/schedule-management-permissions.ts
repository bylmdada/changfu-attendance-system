import { prisma } from '@/lib/database';

type UserScope = {
  role: string;
  employeeId?: number;
};

export function hasFullScheduleManagementAccess(user: UserScope): boolean {
  return user.role === 'ADMIN' || user.role === 'HR';
}

export function buildActiveDeputyAssignmentWhere(deputyEmployeeId: number, now = new Date()) {
  return {
    deputyEmployeeId,
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
  };
}

export async function getManageableDepartments(user: UserScope, now = new Date()): Promise<string[]> {
  if (hasFullScheduleManagementAccess(user)) {
    return [];
  }

  if (!user.employeeId) {
    return [];
  }

  const manageableDepartments: string[] = [];

  const [managerRecords, deputyRecords, permRecord] = await Promise.all([
    prisma.departmentManager.findMany({
      where: { employeeId: user.employeeId, isActive: true },
      select: { department: true }
    }),
    prisma.managerDeputy.findMany({
      where: buildActiveDeputyAssignmentWhere(user.employeeId, now),
      select: {
        manager: {
          select: {
            department: true
          }
        }
      }
    }),
    prisma.attendancePermission.findUnique({
      where: { employeeId: user.employeeId }
    })
  ]);

  manageableDepartments.push(
    ...managerRecords.map((record) => record.department).filter(Boolean),
    ...deputyRecords.map((record) => record.manager.department).filter(Boolean)
  );

  if (permRecord?.permissions) {
    const permissions = permRecord.permissions as { scheduleManagement?: string[] };
    if (Array.isArray(permissions.scheduleManagement)) {
      manageableDepartments.push(...permissions.scheduleManagement.filter(Boolean));
    }
  }

  return [...new Set(manageableDepartments)];
}

export async function canManageScheduleEmployee(
  user: UserScope,
  targetEmployeeId: number,
  now = new Date()
): Promise<boolean> {
  if (hasFullScheduleManagementAccess(user)) {
    return true;
  }

  const manageableDepartments = await getManageableDepartments(user, now);
  if (manageableDepartments.length === 0) {
    return false;
  }

  const targetEmployee = await prisma.employee.findUnique({
    where: { id: targetEmployeeId },
    select: { department: true }
  });

  return Boolean(
    targetEmployee?.department && manageableDepartments.includes(targetEmployee.department)
  );
}
