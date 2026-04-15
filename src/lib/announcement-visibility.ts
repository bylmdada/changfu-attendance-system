import { prisma } from '@/lib/database';

type AnnouncementVisibilityInput = {
  status?: string | null;
  isGlobal?: boolean | null;
  publishAt?: Date | string | null;
  expireAt?: Date | string | null;
  targetDepartments?: unknown;
};

function parseAnnouncementDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeAnnouncementTargetDepartments(value: unknown): string[] {
  let rawValue = value;

  if (typeof rawValue === 'string') {
    try {
      rawValue = JSON.parse(rawValue);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(rawValue)) {
    return [];
  }

  return Array.from(
    new Set(
      rawValue
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function canUserBypassAnnouncementVisibility(role: string): boolean {
  return role === 'ADMIN' || role === 'HR';
}

export async function getAnnouncementViewerDepartment(employeeId: number): Promise<string | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { department: true },
  });

  return employee?.department || null;
}

export function isAnnouncementVisibleToDepartment(
  announcement: AnnouncementVisibilityInput,
  department: string | null,
  now = new Date()
): boolean {
  if (announcement.status !== 'PUBLISHED') {
    return false;
  }

  const publishAt = parseAnnouncementDate(announcement.publishAt);
  if (publishAt && publishAt > now) {
    return false;
  }

  const expireAt = parseAnnouncementDate(announcement.expireAt);
  if (expireAt && expireAt < now) {
    return false;
  }

  if (announcement.isGlobal) {
    return true;
  }

  const targetDepartments = normalizeAnnouncementTargetDepartments(announcement.targetDepartments);
  if (targetDepartments.length === 0) {
    return true;
  }

  return !!department && targetDepartments.includes(department);
}