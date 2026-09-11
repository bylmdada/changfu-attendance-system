import {
  applyAnnualLeaveHoursToSchedules,
  reverseAnnualLeaveHoursFromSchedules,
} from '@/lib/annual-leave-schedule-accounting';

describe('annual leave schedule accounting', () => {
  it('adds and reverses paid leave hours without creating a negative balance', async () => {
    const schedule = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn()
        .mockResolvedValueOnce({ specialLeaveHours: 8 })
        .mockResolvedValueOnce({ specialLeaveHours: 0 }),
      update: jest.fn().mockResolvedValue({}),
    };
    const tx = { schedule } as never;

    await applyAnnualLeaveHoursToSchedules(tx, 10, { '2026-07-09': 8 });
    await reverseAnnualLeaveHoursFromSchedules(tx, 10, { '2026-07-09': 8 });
    await reverseAnnualLeaveHoursFromSchedules(tx, 10, { '2026-07-09': 8 });

    expect(schedule.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 10, workDate: '2026-07-09' },
      data: { specialLeaveHours: { increment: 8 } },
    });
    expect(schedule.update).toHaveBeenCalledTimes(1);
    expect(schedule.update).toHaveBeenCalledWith({
      where: { employeeId_workDate: { employeeId: 10, workDate: '2026-07-09' } },
      data: { specialLeaveHours: { decrement: 8 } },
    });
  });
});
