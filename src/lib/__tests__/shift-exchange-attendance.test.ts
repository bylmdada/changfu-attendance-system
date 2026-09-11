import { hasClockedAttendance } from '@/lib/shift-exchange-attendance';

describe('shift exchange attendance guard', () => {
  it('detects attendance on the Taiwan work date', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 1 });

    await expect(hasClockedAttendance(
      { attendanceRecord: { findFirst } } as never,
      10,
      '2026-07-09'
    )).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ employeeId: 10 }),
    }));
  });
});
