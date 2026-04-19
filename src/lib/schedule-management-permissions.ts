import { prisma } from '@/lib/database';
import {
  type AttendancePermissionReader,
  buildActiveDeputyAssignmentWhere,
  getAttendancePermissionDepartments,
  hasFullAttendanceAccess,
  type UserScope,
} from '@/lib/attendance-permission-scopes';

export { buildActiveDeputyAssignmentWhere };

type ScheduleManagementReader = AttendancePermissionReader & {
  employee: {
    findUnique: (args: {
      where: { id: number };
      select: { department: true };
    }) => Promise<{ department: string | null } | null>;
  };
};

export function hasFullScheduleManagementAccess(user: UserScope): boolean {
  return hasFullAttendanceAccess(user);
}

export async function getManageableDepartments(
  user: UserScope,
  now = new Date(),
  reader: AttendancePermissionReader = prisma
): Promise<string[]> {
  if (hasFullScheduleManagementAccess(user)) {
    return [];
  }

  return getAttendancePermissionDepartments(user, 'scheduleManagement', now, reader);
}

export async function canManageScheduleEmployee(
  user: UserScope,
  targetEmployeeId: number,
  now = new Date(),
  reader: ScheduleManagementReader = prisma
): Promise<boolean> {
  if (hasFullScheduleManagementAccess(user)) {
    return true;
  }

  const manageableDepartments = await getManageableDepartments(user, now, reader);
  if (manageableDepartments.length === 0) {
    return false;
  }

  const targetEmployee = await reader.employee.findUnique({
    where: { id: targetEmployeeId },
    select: { department: true }
  });

  return Boolean(
    targetEmployee?.department && manageableDepartments.includes(targetEmployee.department)
  );
}
