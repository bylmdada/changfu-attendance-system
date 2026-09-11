import {
  assignShiftToDate,
  assignShiftToDates,
  buildShiftDateGroups,
  listAssignedDates,
  replaceAssignedDates,
  toggleAssignedDate,
} from '../schedule-batch-assignments';

describe('schedule batch assignments', () => {
  it('toggles dates using the current default shift type', () => {
    const added = toggleAssignedDate({}, '2026-06-03', 'A');
    expect(added).toEqual({ '2026-06-03': 'A' });

    const removed = toggleAssignedDate(added, '2026-06-03', 'B');
    expect(removed).toEqual({});
  });

  it('replaces and bulk updates assigned dates with one shift type', () => {
    const replaced = replaceAssignedDates(['2026-06-04', '2026-06-03', '2026-06-03'], 'OFF');
    expect(replaced).toEqual({
      '2026-06-03': 'OFF',
      '2026-06-04': 'OFF',
    });

    const reassigned = assignShiftToDates(replaced, ['2026-06-04'], 'A');
    expect(reassigned).toEqual({
      '2026-06-03': 'OFF',
      '2026-06-04': 'A',
    });
  });

  it('lists and groups dates by shift type for batch saving', () => {
    const assignments = assignShiftToDate(
      assignShiftToDate(
        assignShiftToDate({}, '2026-06-05', 'B'),
        '2026-06-03',
        'A'
      ),
      '2026-06-04',
      'A'
    );

    expect(listAssignedDates(assignments)).toEqual([
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
    expect(buildShiftDateGroups(assignments)).toEqual([
      { shiftType: 'A', workDates: ['2026-06-03', '2026-06-04'] },
      { shiftType: 'B', workDates: ['2026-06-05'] },
    ]);
  });
});
