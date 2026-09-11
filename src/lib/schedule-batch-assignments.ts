export type DateShiftAssignments = Record<string, string>;

function normalizeDateKey(date: string) {
  return date.trim();
}

export function listAssignedDates(assignments: DateShiftAssignments) {
  return Object.keys(assignments).sort();
}

export function toggleAssignedDate(
  assignments: DateShiftAssignments,
  date: string,
  defaultShiftType: string
) {
  const normalizedDate = normalizeDateKey(date);
  if (!normalizedDate || !defaultShiftType.trim()) {
    return assignments;
  }

  if (assignments[normalizedDate]) {
    const nextAssignments = { ...assignments };
    delete nextAssignments[normalizedDate];
    return nextAssignments;
  }

  return {
    ...assignments,
    [normalizedDate]: defaultShiftType.trim(),
  };
}

export function assignShiftToDate(
  assignments: DateShiftAssignments,
  date: string,
  shiftType: string
) {
  const normalizedDate = normalizeDateKey(date);
  if (!normalizedDate || !shiftType.trim()) {
    return assignments;
  }

  return {
    ...assignments,
    [normalizedDate]: shiftType.trim(),
  };
}

export function replaceAssignedDates(dates: string[], shiftType: string) {
  const normalizedShiftType = shiftType.trim();
  if (!normalizedShiftType) {
    return {};
  }

  return Array.from(new Set(dates.map(normalizeDateKey).filter(Boolean)))
    .sort()
    .reduce<DateShiftAssignments>((accumulator, date) => {
      accumulator[date] = normalizedShiftType;
      return accumulator;
    }, {});
}

export function assignShiftToDates(
  assignments: DateShiftAssignments,
  dates: string[],
  shiftType: string
) {
  const normalizedShiftType = shiftType.trim();
  if (!normalizedShiftType) {
    return assignments;
  }

  const nextAssignments = { ...assignments };
  Array.from(new Set(dates.map(normalizeDateKey).filter(Boolean))).forEach((date) => {
    nextAssignments[date] = normalizedShiftType;
  });
  return nextAssignments;
}

export function buildShiftDateGroups(assignments: DateShiftAssignments) {
  const groupedDates = new Map<string, string[]>();

  Object.entries(assignments).forEach(([date, shiftType]) => {
    const normalizedDate = normalizeDateKey(date);
    const normalizedShiftType = shiftType.trim();
    if (!normalizedDate || !normalizedShiftType) {
      return;
    }

    const dates = groupedDates.get(normalizedShiftType) ?? [];
    dates.push(normalizedDate);
    groupedDates.set(normalizedShiftType, dates);
  });

  return Array.from(groupedDates.entries())
    .map(([shiftType, workDates]) => ({
      shiftType,
      workDates: Array.from(new Set(workDates)).sort(),
    }))
    .sort((left, right) => {
      const firstLeftDate = left.workDates[0] ?? '';
      const firstRightDate = right.workDates[0] ?? '';
      return firstLeftDate.localeCompare(firstRightDate);
    });
}
