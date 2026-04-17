export const STANDARD_REGULAR_HOURS = 8;

type DateLike = Date | string | null | undefined;

function toDate(value: DateLike): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value instanceof Date ? value : new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

export function calculateAttendanceHours(
  clockInTime: DateLike,
  clockOutTime: DateLike,
  standardHours = STANDARD_REGULAR_HOURS,
  breakMinutes = 0
) {
  const clockIn = toDate(clockInTime);
  const clockOut = toDate(clockOutTime);

  if (!clockIn || !clockOut) {
    return {
      totalHours: 0,
      regularHours: 0,
      overtimeHours: 0,
    };
  }

  const rawHours = Math.max(
    0,
    (clockOut.getTime() - clockIn.getTime() - Math.max(0, breakMinutes) * 60 * 1000) / (1000 * 60 * 60)
  );
  const regularHours = Math.min(rawHours, standardHours);
  const overtimeHours = Math.max(0, rawHours - standardHours);

  return {
    totalHours: roundHours(rawHours),
    regularHours: roundHours(regularHours),
    overtimeHours: roundHours(overtimeHours),
  };
}

export function getStoredOrCalculatedAttendanceHours(record: {
  clockInTime?: DateLike;
  clockOutTime?: DateLike;
  regularHours?: number | null;
  overtimeHours?: number | null;
  breakTime?: number | null;
}) {
  const calculated = calculateAttendanceHours(
    record.clockInTime,
    record.clockOutTime,
    STANDARD_REGULAR_HOURS,
    record.breakTime || 0
  );

  if (calculated.totalHours > 0) {
    return calculated;
  }

  const regularHours = roundHours(record.regularHours || 0);
  const overtimeHours = roundHours(record.overtimeHours || 0);

  return {
    totalHours: roundHours(regularHours + overtimeHours),
    regularHours,
    overtimeHours,
  };
}