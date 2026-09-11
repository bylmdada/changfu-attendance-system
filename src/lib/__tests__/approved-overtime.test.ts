import {
  indexApprovedOvertimeRequests,
  resolveApprovedAttendanceOvertime,
} from '../approved-overtime';
import {
  calculateActualOvertimeHoursFromTimeRange,
  calculateOvertimeHoursFromTimeRange,
  normalizeOvertimeUnitMinutes,
  roundOvertimeHoursToUnit,
} from '../overtime-hours';
import { normalizeOvertimeCalculationSettings } from '../overtime-settings';

describe('approved overtime helpers', () => {
  it('does not recognize clock duration above eight hours without an approved overtime request', () => {
    const result = resolveApprovedAttendanceOvertime(
      {
        employeeId: 100,
        workDate: new Date('2026-07-17T00:00:00.000Z'),
        regularHours: 8,
        actualWorkHours: 9,
        overtimeHours: 1,
      },
      indexApprovedOvertimeRequests([]),
      60
    );

    expect(result.rawAttendanceHours).toBe(1);
    expect(result.hasApprovedRequest).toBe(false);
    expect(result.effectiveHours).toBe(0);
  });

  it('rounds overtime hours using the configured minimum unit', () => {
    expect(roundOvertimeHoursToUnit(1.01, 15)).toBe(1);
    expect(calculateOvertimeHoursFromTimeRange('18:00', '18:59', 60)).toBe(0);
    expect(calculateOvertimeHoursFromTimeRange('18:00', '19:00', 60)).toBe(1);
    expect(calculateOvertimeHoursFromTimeRange('18:00', '19:14', 15)).toBe(1);
    expect(calculateOvertimeHoursFromTimeRange('18:00', '19:15', 15)).toBe(1.25);
  });

  it('calculates truthful elapsed overtime hours without inflating short ranges', () => {
    expect(calculateActualOvertimeHoursFromTimeRange('17:00', '17:09')).toBe(0.15);
    expect(calculateActualOvertimeHoursFromTimeRange('17:00', '19:31')).toBe(2.52);
    expect(calculateActualOvertimeHoursFromTimeRange('17:00:30', '18:00')).toBeNull();
  });

  it('only accepts supported minimum application units', () => {
    expect(normalizeOvertimeUnitMinutes(1)).toBe(1);
    expect(normalizeOvertimeUnitMinutes(60)).toBe(60);
    expect(normalizeOvertimeUnitMinutes(7)).toBe(30);
    expect(normalizeOvertimeUnitMinutes(60.5)).toBe(30);
    expect(normalizeOvertimeUnitMinutes('60' as never)).toBe(30);

    expect(normalizeOvertimeCalculationSettings({ overtimeMinUnit: 60 }).overtimeMinUnit).toBe(60);
    expect(
      normalizeOvertimeCalculationSettings({ overtimeMinUnit: '60' as never }).overtimeMinUnit
    ).toBe(30);
  });

  it('limits valid overtime to approved request hours while preserving actual worked minutes', () => {
    const approvedIndex = indexApprovedOvertimeRequests([
      {
        id: 1,
        employeeId: 100,
        overtimeDate: new Date('2026-05-01T00:00:00.000Z'),
        totalHours: 2,
        compensationType: 'OVERTIME_PAY',
      },
      {
        id: 2,
        employeeId: 100,
        overtimeDate: new Date('2026-05-01T00:00:00.000Z'),
        totalHours: 1,
        compensationType: 'COMP_LEAVE',
      },
    ]);

    const result = resolveApprovedAttendanceOvertime(
      {
        employeeId: 100,
        workDate: new Date('2026-05-01T00:00:00.000Z'),
        overtimeHours: 2.6,
      },
      approvedIndex,
      30
    );

    expect(result.effectiveHours).toBe(2.6);
    expect(result.payableHours).toBe(2);
    expect(result.compLeaveHours).toBe(0.6);
  });

  it('preserves approved request minutes after the minimum application threshold is met', () => {
    const approvedIndex = indexApprovedOvertimeRequests([
      {
        id: 1,
        employeeId: 100,
        overtimeDate: new Date('2026-05-01T00:00:00.000Z'),
        totalHours: 1.49,
        compensationType: 'OVERTIME_PAY',
      },
      {
        id: 2,
        employeeId: 100,
        overtimeDate: new Date('2026-05-01T00:00:00.000Z'),
        totalHours: 1.49,
        compensationType: 'OVERTIME_PAY',
      },
    ]);

    const result = resolveApprovedAttendanceOvertime(
      {
        employeeId: 100,
        workDate: new Date('2026-05-01T00:00:00.000Z'),
        overtimeHours: 3,
      },
      approvedIndex,
      30
    );

    expect(result.approvedRequestHours).toBe(2.98);
    expect(result.effectiveHours).toBe(2.98);
    expect(result.payableHours).toBe(2.98);
  });

  it.each([
    {
      name: '遲到 1 小時加上核准延長 1 小時，實際淨工時僅 8 小時',
      regularHours: 7,
      actualWorkHours: 8,
      rawOvertimeHours: 1,
      expectedOvertimeHours: 0,
    },
    {
      name: '正常工時 8 小時加上核准延長 1 小時，實際淨工時為 9 小時',
      regularHours: 8,
      actualWorkHours: 9,
      rawOvertimeHours: 1,
      expectedOvertimeHours: 1,
    },
  ])('enforces the statutory daily threshold: $name', ({
    regularHours,
    actualWorkHours,
    rawOvertimeHours,
    expectedOvertimeHours,
  }) => {
    const approvedIndex = indexApprovedOvertimeRequests([
      {
        id: 10,
        employeeId: 100,
        overtimeDate: new Date('2026-07-17T00:00:00.000Z'),
        totalHours: 1,
        compensationType: 'OVERTIME_PAY',
      },
    ]);

    const result = resolveApprovedAttendanceOvertime(
      {
        employeeId: 100,
        workDate: new Date('2026-07-17T00:00:00.000Z'),
        regularHours,
        actualWorkHours,
        overtimeHours: rawOvertimeHours,
        clockOutOvertimeId: 10,
      } as never,
      approvedIndex,
      30
    );

    expect(result.effectiveHours).toBe(expectedOvertimeHours);
    expect(result.regularHours).toBe(8);
  });

  it('keeps the actual minutes worked above eight hours even when requests use 60-minute units', () => {
    const workDate = new Date('2026-05-13T00:00:00.000Z');
    const approvedIndex = indexApprovedOvertimeRequests([
      {
        id: 12,
        employeeId: 100,
        overtimeDate: workDate,
        totalHours: 2,
        compensationType: 'COMP_LEAVE',
      },
    ]);

    const result = resolveApprovedAttendanceOvertime(
      {
        employeeId: 100,
        workDate,
        regularHours: 8,
        actualWorkHours: 8.19,
        overtimeHours: 0.19,
        overtimeType: 'WEEKDAY',
      },
      approvedIndex,
      60
    );

    expect(result.effectiveHours).toBe(0.19);
    expect(result.compLeaveHours).toBe(0.19);
  });

  it('keeps the first approved hours payable on a statutory rest day', () => {
    const workDate = new Date('2026-07-18T00:00:00.000Z');
    const approvedIndex = indexApprovedOvertimeRequests([
      {
        id: 11,
        employeeId: 100,
        overtimeDate: workDate,
        totalHours: 4,
        compensationType: 'OVERTIME_PAY',
      },
    ]);

    const result = resolveApprovedAttendanceOvertime(
      {
        employeeId: 100,
        workDate,
        regularHours: 0,
        actualWorkHours: 4,
        overtimeHours: 0,
        overtimeType: 'REST_DAY',
        clockOutOvertimeId: 11,
      },
      approvedIndex,
      30
    );

    expect(result.regularHours).toBe(0);
    expect(result.effectiveHours).toBe(4);
    expect(result.payableHours).toBe(4);
  });
});
