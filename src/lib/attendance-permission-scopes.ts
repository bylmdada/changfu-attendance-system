import { prisma } from '@/lib/database';

export type UserScope = {
  role: string;
  employeeId?: number;
};

export const ATTENDANCE_PERMISSION_KEYS = [
  'leaveRequests',
  'overtimeRequests',
  'shiftExchanges',
  'scheduleManagement',
] as const;

export type AttendancePermissionKey = (typeof ATTENDANCE_PERMISSION_KEYS)[number];

export type AttendancePermissions = Record<AttendancePermissionKey, string[]>;

export type AttendancePermissionReader = {
  departmentManager: {
    findMany: (args: {
      where: { employeeId: number; isActive: true };
      select: { department: true };
    }) => Promise<Array<{ department: string | null }>>;
  };
  managerDeputy: {
    findMany: (args: {
      where: ReturnType<typeof buildActiveDeputyAssignmentWhere>;
      select: { manager: { select: { department: true } } };
    }) => Promise<Array<{ manager: { department: string | null } }>>;
  };
  attendancePermission: {
    findUnique: (args: {
      where: { employeeId: number };
      select: { permissions: true };
    }) => Promise<{ permissions: unknown } | null>;
  };
};

export const EMPTY_ATTENDANCE_PERMISSIONS: AttendancePermissions = {
  leaveRequests: [],
  overtimeRequests: [],
  shiftExchanges: [],
  scheduleManagement: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDepartmentList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

export function normalizeAttendancePermissions(value: unknown): AttendancePermissions {
  const source = isPlainObject(value) ? value : {};

  return {
    leaveRequests: normalizeDepartmentList(source.leaveRequests),
    overtimeRequests: normalizeDepartmentList(source.overtimeRequests),
    shiftExchanges: normalizeDepartmentList(source.shiftExchanges),
    scheduleManagement: normalizeDepartmentList(source.scheduleManagement),
  };
}

export function hasFullAttendanceAccess(user: UserScope): boolean {
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

export async function getAttendancePermissionDepartments(
  user: UserScope,
  permissionKey: AttendancePermissionKey,
  now = new Date(),
  reader: AttendancePermissionReader = prisma
): Promise<string[]> {
  if (hasFullAttendanceAccess(user)) {
    return [];
  }

  if (!user.employeeId) {
    return [];
  }

  const [managerRecords, deputyRecords, permissionRecord] = await Promise.all([
    reader.departmentManager.findMany({
      where: { employeeId: user.employeeId, isActive: true },
      select: { department: true }
    }),
    reader.managerDeputy.findMany({
      where: buildActiveDeputyAssignmentWhere(user.employeeId, now),
      select: {
        manager: {
          select: {
            department: true
          }
        }
      }
    }),
    reader.attendancePermission.findUnique({
      where: { employeeId: user.employeeId },
      select: { permissions: true }
    })
  ]);

  const normalizedPermissions = normalizeAttendancePermissions(permissionRecord?.permissions);

  return [...new Set([
    ...managerRecords
      .map((record) => record.department)
      .filter((department): department is string => Boolean(department)),
    ...deputyRecords
      .map((record) => record.manager.department)
      .filter((department): department is string => Boolean(department)),
    ...normalizedPermissions[permissionKey],
  ])];
}

export async function canAccessAttendanceDepartment(
  user: UserScope,
  department: string | null | undefined,
  permissionKey: AttendancePermissionKey,
  now = new Date(),
  reader: AttendancePermissionReader = prisma
): Promise<boolean> {
  if (hasFullAttendanceAccess(user)) {
    return true;
  }

  if (!department) {
    return false;
  }

  const departments = await getAttendancePermissionDepartments(user, permissionKey, now, reader);
  return departments.includes(department);
}
