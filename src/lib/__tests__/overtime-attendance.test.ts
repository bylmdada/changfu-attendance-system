import { clearOvertimeAttendanceLinks } from '@/lib/overtime-attendance';

describe('overtime attendance cleanup', () => {
  it('clears both clock links for the cancelled request', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });

    await clearOvertimeAttendanceLinks({ attendanceRecord: { updateMany } } as never, 18);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { clockInOvertimeId: 18 },
      data: { clockInOvertimeId: null },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { clockOutOvertimeId: 18 },
      data: { clockOutOvertimeId: null },
    });
  });
});
