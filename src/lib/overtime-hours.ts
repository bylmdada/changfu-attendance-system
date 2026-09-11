function roundHours(hours: number) {
  return Math.round(hours * 100) / 100;
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
}

export function normalizeOvertimeUnitMinutes(unitMinutes?: number | null) {
  if (
    typeof unitMinutes !== 'number'
    || !Number.isInteger(unitMinutes)
    || ![1, 5, 15, 30, 60].includes(unitMinutes)
  ) {
    return 30;
  }

  return unitMinutes;
}

/** @deprecated 不得用來捨去已實際工作的分鐘；設定單位僅作最低申請門檻。 */
export function roundOvertimeHoursToUnit(hours: number, unitMinutes?: number | null) {
  if (!Number.isFinite(hours) || hours <= 0) {
    return 0;
  }

  const normalizedUnitMinutes = normalizeOvertimeUnitMinutes(unitMinutes);
  const totalMinutes = hours * 60;

  return roundHours(Math.floor(totalMinutes / normalizedUnitMinutes) * normalizedUnitMinutes / 60);
}

/** @deprecated 僅供舊資料比較；不得用來計算或儲存實際認列加班時數。 */
export function calculateOvertimeHoursFromTimeRange(
  startTime: string,
  endTime: string,
  unitMinutes?: number | null
) {
  const rawHours = calculateActualOvertimeHoursFromTimeRange(startTime, endTime);
  if (rawHours === null) {
    return null;
  }

  return roundOvertimeHoursToUnit(rawHours, unitMinutes);
}

export function calculateActualOvertimeHoursFromTimeRange(
  startTime: string,
  endTime: string
) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  let totalMinutes = endMinutes - startMinutes;
  if (totalMinutes < 0) {
    totalMinutes += 24 * 60;
  }

  return roundHours(totalMinutes / 60);
}

export function getMinimumOvertimeHours(unitMinutes?: number | null) {
  return roundHours(normalizeOvertimeUnitMinutes(unitMinutes) / 60);
}
