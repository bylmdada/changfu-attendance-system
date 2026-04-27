const SPECIAL_SHIFT_LABELS: Record<string, string> = {
  NH: 'NH (國定假日)',
  RD: 'RD (例假)',
  rd: 'rd (休息日)',
  FDL: 'FDL (全日請假)',
  OFF: 'OFF (休假)',
  TD: 'TD (天災假)',
};

export const SHIFT_LABELS: Record<string, string> = {
  A: 'A班 (07:30-16:30)',
  B: 'B班 (08:00-17:00)',
  C: 'C班 (08:30-17:30)',
  ...SPECIAL_SHIFT_LABELS,
};

const appendShiftSuffix = (shiftType: string) => (
  shiftType.includes('班') ? shiftType : `${shiftType}班`
);

interface ShiftDisplayInput {
  shiftType?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

export const getShiftLabel = (shiftType?: string | null) => {
  const normalizedShiftType = shiftType?.trim();

  if (!normalizedShiftType) {
    return '-';
  }

  return SHIFT_LABELS[normalizedShiftType] || appendShiftSuffix(normalizedShiftType);
};

export const formatShiftDisplay = ({ shiftType, startTime, endTime }: ShiftDisplayInput) => {
  const normalizedShiftType = shiftType?.trim();
  const hasTimeRange = Boolean(startTime && endTime);

  if (!normalizedShiftType) {
    return hasTimeRange ? `${startTime}-${endTime}` : '-';
  }

  if (SPECIAL_SHIFT_LABELS[normalizedShiftType]) {
    return SPECIAL_SHIFT_LABELS[normalizedShiftType];
  }

  if (hasTimeRange) {
    return `${appendShiftSuffix(normalizedShiftType)} (${startTime}-${endTime})`;
  }

  return getShiftLabel(normalizedShiftType);
};
