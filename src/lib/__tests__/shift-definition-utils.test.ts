import {
  DEFAULT_SHIFT_DEFINITIONS,
  buildDefaultShiftDTOs,
  formatShiftDefinitionLabel,
  formatScheduleTimeLabel,
  getShiftColorClass,
  isScheduleHourConsistent,
  resolveScheduleHourFields,
} from '@/lib/shift-definition-utils';

describe('shift definition utils', () => {
  it('keeps leave hour defaults for no-time leave shifts', () => {
    const fullDayLeave = DEFAULT_SHIFT_DEFINITIONS.find((shift) => shift.code === 'FDL');
    const compLeave = DEFAULT_SHIFT_DEFINITIONS.find((shift) => shift.code === 'OFF');

    expect(fullDayLeave).toEqual(expect.objectContaining({
      requiresTime: false,
      specialLeaveHours: 8,
      compLeaveHours: 0,
    }));
    expect(compLeave).toEqual(expect.objectContaining({
      requiresTime: false,
      specialLeaveHours: 0,
      compLeaveHours: 8,
    }));
  });

  it('renders no-time shift labels with leave hour summaries', () => {
    expect(formatShiftDefinitionLabel({
      code: 'FDL',
      name: '全日請假',
      startTime: '',
      endTime: '',
      requiresTime: false,
      workHours: 0,
      specialLeaveHours: 8,
      compLeaveHours: 0,
      overtimeHours: 0,
    })).toBe('FDL (全日請假｜工時 0小時 / 特休 8小時)');

    expect(formatShiftDefinitionLabel({
      code: 'OFF',
      name: '休假',
      startTime: '',
      endTime: '',
      requiresTime: false,
      workHours: 0,
      specialLeaveHours: 0,
      compLeaveHours: 8,
      overtimeHours: 0,
    })).toBe('OFF (休假｜工時 0小時 / 補休 8小時)');
  });

  it('falls back to shift definition hours when a legacy timed schedule keeps zeroed hour fields', () => {
    const resolved = resolveScheduleHourFields({
      shiftType: 'B',
      startTime: '08:00',
      endTime: '17:00',
      breakTime: 60,
      workHours: 0,
      specialLeaveHours: 0,
      compLeaveHours: 0,
      overtimeHours: 0,
    }, buildDefaultShiftDTOs());

    expect(resolved.workHours).toBe(8);
    expect(resolved.usedDefinitionFallback).toBe(true);
    expect(formatScheduleTimeLabel(resolved)).toBe('08:00-17:00');
  });

  it('keeps non-time leave shift hour summaries consistent for legacy zero-hour records', () => {
    const resolved = resolveScheduleHourFields({
      shiftType: 'FDL',
      startTime: '',
      endTime: '',
      breakTime: 0,
      workHours: 0,
      specialLeaveHours: 0,
      compLeaveHours: 0,
      overtimeHours: 0,
    }, buildDefaultShiftDTOs());

    expect(resolved.specialLeaveHours).toBe(8);
    expect(resolved.usedDefinitionFallback).toBe(true);
    expect(formatScheduleTimeLabel(resolved)).toBe('全日請假');
  });

  it('derives work hours from stored time ranges when a custom timed shift has no saved hours', () => {
    const resolved = resolveScheduleHourFields({
      shiftType: 'B',
      startTime: '09:00',
      endTime: '18:00',
      breakTime: 60,
      workHours: 0,
      specialLeaveHours: 0,
      compLeaveHours: 0,
      overtimeHours: 0,
    }, buildDefaultShiftDTOs());

    expect(resolved.workHours).toBe(8);
    expect(resolved.usedDefinitionFallback).toBe(false);
    expect(resolved.usedCalculatedWorkHours).toBe(true);
  });

  it('rejects manual work hours that do not match the time range and break', () => {
    expect(isScheduleHourConsistent('09:00', '18:00', 60, 8)).toBe(true);
    expect(isScheduleHourConsistent('09:00', '18:00', 60, 4)).toBe(false);
  });

  it('uses different calendar colors for different shifts', () => {
    const shifts = buildDefaultShiftDTOs();
    const colors = ['A', 'B', 'RD'].map((code) => getShiftColorClass(code, shifts));

    expect(new Set(colors).size).toBe(colors.length);
  });
});
