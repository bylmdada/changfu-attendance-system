export const LEAVE_MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const minute = index * 5;

  return {
    value: String(minute).padStart(2, '0'),
    label: `${minute}分`,
  };
});

export function isValidLeaveMinute(value: string | number): boolean {
  const minute = Number(value);
  return Number.isInteger(minute) && minute >= 0 && minute <= 55 && minute % 5 === 0;
}

export function isValidLeaveDurationMinutes(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value % 5 === 0;
}
