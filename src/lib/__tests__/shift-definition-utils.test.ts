import {
  DEFAULT_SHIFT_DEFINITIONS,
  formatShiftDefinitionLabel,
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
});
