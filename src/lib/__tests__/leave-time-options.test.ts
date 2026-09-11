import {
  LEAVE_MINUTE_OPTIONS,
  isValidLeaveDurationMinutes,
  isValidLeaveMinute,
} from '@/lib/leave-time-options';

describe('leave time options', () => {
  it('offers every five-minute value from 0 through 55', () => {
    expect(LEAVE_MINUTE_OPTIONS).toEqual([
      { value: '00', label: '0分' },
      { value: '05', label: '5分' },
      { value: '10', label: '10分' },
      { value: '15', label: '15分' },
      { value: '20', label: '20分' },
      { value: '25', label: '25分' },
      { value: '30', label: '30分' },
      { value: '35', label: '35分' },
      { value: '40', label: '40分' },
      { value: '45', label: '45分' },
      { value: '50', label: '50分' },
      { value: '55', label: '55分' },
    ]);
  });

  it('accepts only whole five-minute values within an hour', () => {
    expect(isValidLeaveMinute('0')).toBe(true);
    expect(isValidLeaveMinute('05')).toBe(true);
    expect(isValidLeaveMinute(55)).toBe(true);
    expect(isValidLeaveMinute('07')).toBe(false);
    expect(isValidLeaveMinute(60)).toBe(false);
  });

  it('requires a positive duration in five-minute increments', () => {
    expect(isValidLeaveDurationMinutes(5)).toBe(true);
    expect(isValidLeaveDurationMinutes(65)).toBe(true);
    expect(isValidLeaveDurationMinutes(0)).toBe(false);
    expect(isValidLeaveDurationMinutes(7)).toBe(false);
  });
});
