import {
  applyMissedClockToAttendance,
  getMissedClockDateTime,
  MissedClockTimeError,
  removeMissedClockFromAttendance,
} from '../missed-clock-attendance';

// 台北 = UTC+8。工作日 2026-11-23 的台北 00:00 = 2026-11-22T16:00Z
const NIGHT_SHIFT = { startTime: '22:00', endTime: '06:00', breakTime: 0, workHours: 8, shiftType: 'N' };
const DAY_SHIFT = { startTime: '08:00', endTime: '17:00', breakTime: 60, workHours: 8, shiftType: 'A' };

function utc(value: string) {
  return new Date(value);
}

function makeClient(options: {
  schedule?: Record<string, unknown> | null;
  existing?: Record<string, unknown> | null;
}) {
  return {
    schedule: { findFirst: jest.fn().mockResolvedValue(options.schedule ?? null) },
    attendanceRecord: {
      findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 1, ...data })),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 2, ...data })),
    },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    overtimeRequest: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const request = (clockType: 'CLOCK_IN' | 'CLOCK_OUT', requestedTime: string) => ({
  employeeId: 7,
  workDate: '2026-11-23',
  clockType,
  requestedTime,
});

describe('getMissedClockDateTime', () => {
  it('keeps 工作日 + 時:分 for day shifts and when there is no schedule', () => {
    expect(getMissedClockDateTime('2026-11-23', '17:30', 'CLOCK_OUT', DAY_SHIFT)).toEqual(utc('2026-11-23T09:30:00Z'));
    expect(getMissedClockDateTime('2026-11-23', '06:00', 'CLOCK_OUT', null)).toEqual(utc('2026-11-22T22:00:00Z'));
    expect(getMissedClockDateTime('2026-11-23', '06:00')).toEqual(utc('2026-11-22T22:00:00Z'));
  });

  it('places the clock-out of a cross-midnight shift on the next day', () => {
    // 11/23 22:00 上班，補 06:00 下班 → 11/24 06:00（台北）= 11/23 22:00Z
    expect(getMissedClockDateTime('2026-11-23', '06:00', 'CLOCK_OUT', NIGHT_SHIFT)).toEqual(utc('2026-11-23T22:00:00Z'));
    // 稍微晚下班
    expect(getMissedClockDateTime('2026-11-23', '06:20', 'CLOCK_OUT', NIGHT_SHIFT)).toEqual(utc('2026-11-23T22:20:00Z'));
    // 超過班次較久也歸隔天，而不是退回前一天
    expect(getMissedClockDateTime('2026-11-23', '09:00', 'CLOCK_OUT', NIGHT_SHIFT)).toEqual(utc('2026-11-24T01:00:00Z'));
  });

  it('keeps same-day punches of a cross-midnight shift on the work date', () => {
    expect(getMissedClockDateTime('2026-11-23', '22:00', 'CLOCK_IN', NIGHT_SHIFT)).toEqual(utc('2026-11-23T14:00:00Z'));
    expect(getMissedClockDateTime('2026-11-23', '21:45', 'CLOCK_IN', NIGHT_SHIFT)).toEqual(utc('2026-11-23T13:45:00Z'));
    // 提早在午夜前離開
    expect(getMissedClockDateTime('2026-11-23', '23:30', 'CLOCK_OUT', NIGHT_SHIFT)).toEqual(utc('2026-11-23T15:30:00Z'));
  });

  it('places a clock-in after midnight (arrived late) on the next day', () => {
    expect(getMissedClockDateTime('2026-11-23', '00:30', 'CLOCK_IN', NIGHT_SHIFT)).toEqual(utc('2026-11-23T16:30:00Z'));
  });

  it('breaks an exact tie by clock type: in = work date, out = next day', () => {
    // 14:00 離 22:00 和 06:00 一樣遠
    expect(getMissedClockDateTime('2026-11-23', '14:00', 'CLOCK_IN', NIGHT_SHIFT)).toEqual(utc('2026-11-23T06:00:00Z'));
    expect(getMissedClockDateTime('2026-11-23', '14:00', 'CLOCK_OUT', NIGHT_SHIFT)).toEqual(utc('2026-11-24T06:00:00Z'));
  });

  it('rejects malformed times with a MissedClockTimeError', () => {
    expect(() => getMissedClockDateTime('2026-11-23', '25:00')).toThrow(MissedClockTimeError);
    expect(() => getMissedClockDateTime('2026-11-23', 'abc')).toThrow(MissedClockTimeError);
    expect(() => getMissedClockDateTime('11/23', '08:00')).toThrow(MissedClockTimeError);
  });
});

describe('applyMissedClockToAttendance', () => {
  it('writes a night-shift clock-out on the next day while keeping the work date and full hours', async () => {
    const client = makeClient({
      schedule: NIGHT_SHIFT,
      existing: {
        id: 1,
        workDate: utc('2026-11-22T16:00:00Z'),
        clockInTime: utc('2026-11-23T14:00:00Z'),
        clockOutTime: null,
      },
    });

    await applyMissedClockToAttendance(client as never, request('CLOCK_OUT', '06:00'));

    expect(client.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        clockOutTime: utc('2026-11-23T22:00:00Z'),
        regularHours: 8,
        overtimeHours: 0,
      },
    });
    expect(client.attendanceRecord.create).not.toHaveBeenCalled();
  });

  it('creates the record on the shift work date when a night-shift clock-in is supplemented', async () => {
    const client = makeClient({ schedule: NIGHT_SHIFT, existing: null });

    await applyMissedClockToAttendance(client as never, request('CLOCK_IN', '22:00'));

    expect(client.attendanceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 7,
        workDate: utc('2026-11-22T16:00:00Z'),
        clockInTime: utc('2026-11-23T14:00:00Z'),
        regularHours: 0,
        overtimeHours: 0,
      }),
    });
  });

  it('refuses a supplement that would put the clock-out before the clock-in', async () => {
    const client = makeClient({
      schedule: DAY_SHIFT,
      existing: {
        id: 1,
        workDate: utc('2026-11-22T16:00:00Z'),
        clockInTime: utc('2026-11-23T00:00:00Z'), // 08:00
        clockOutTime: null,
      },
    });

    await expect(applyMissedClockToAttendance(client as never, request('CLOCK_OUT', '07:00'))).rejects.toThrow(
      /不晚於上班時間.*請申請人確認/
    );
    expect(client.attendanceRecord.update).not.toHaveBeenCalled();
    expect(client.attendanceRecord.create).not.toHaveBeenCalled();
  });

  it('keeps day-shift supplements on the work date', async () => {
    const client = makeClient({
      schedule: DAY_SHIFT,
      existing: {
        id: 1,
        workDate: utc('2026-11-22T16:00:00Z'),
        clockInTime: utc('2026-11-23T00:00:00Z'), // 08:00
        clockOutTime: null,
      },
    });

    await applyMissedClockToAttendance(client as never, request('CLOCK_OUT', '17:00'));

    expect(client.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ clockOutTime: utc('2026-11-23T09:00:00Z'), regularHours: 8 }),
    });
  });
});

describe('removeMissedClockFromAttendance', () => {
  const nightRecord = (clockOutTime: Date | null) => ({
    id: 1,
    workDate: utc('2026-11-22T16:00:00Z'),
    clockInTime: utc('2026-11-23T14:00:00Z'),
    clockOutTime,
  });

  it('clears only the supplemented night-shift clock-out (next-day time)', async () => {
    const client = makeClient({ schedule: NIGHT_SHIFT, existing: nightRecord(utc('2026-11-23T22:00:00Z')) });

    await removeMissedClockFromAttendance(client as never, request('CLOCK_OUT', '06:00'));

    expect(client.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { clockOutTime: null, regularHours: 0, overtimeHours: 0 },
    });
  });

  it('still clears a clock-out written by the old same-day rule', async () => {
    const client = makeClient({ schedule: NIGHT_SHIFT, existing: nightRecord(utc('2026-11-22T22:00:00Z')) });

    await removeMissedClockFromAttendance(client as never, request('CLOCK_OUT', '06:00'));

    expect(client.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ clockOutTime: null }),
    });
  });

  it('still clears it after the schedule was changed to a day shift', async () => {
    const client = makeClient({ schedule: DAY_SHIFT, existing: nightRecord(utc('2026-11-23T22:00:00Z')) });

    await removeMissedClockFromAttendance(client as never, request('CLOCK_OUT', '06:00'));

    expect(client.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ clockOutTime: null }),
    });
  });

  it('leaves a clock-out that was corrected after the supplement', async () => {
    const existing = nightRecord(utc('2026-11-23T22:10:00Z')); // 06:10，已被更正
    const client = makeClient({ schedule: NIGHT_SHIFT, existing });

    const result = await removeMissedClockFromAttendance(client as never, request('CLOCK_OUT', '06:00'));

    expect(client.attendanceRecord.update).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('clears only the targeted side of a day-shift record', async () => {
    const existing = {
      id: 1,
      workDate: utc('2026-11-22T16:00:00Z'),
      clockInTime: utc('2026-11-23T00:00:00Z'),
      clockOutTime: utc('2026-11-23T09:30:00Z'),
    };
    const client = makeClient({ schedule: DAY_SHIFT, existing });

    await removeMissedClockFromAttendance(client as never, request('CLOCK_OUT', '17:30'));

    expect(client.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { clockOutTime: null, regularHours: 0, overtimeHours: 0 },
    });
  });

  it('does nothing when the attendance record no longer exists', async () => {
    const client = makeClient({ schedule: NIGHT_SHIFT, existing: null });

    await expect(removeMissedClockFromAttendance(client as never, request('CLOCK_OUT', '06:00'))).resolves.toBeNull();
    expect(client.attendanceRecord.update).not.toHaveBeenCalled();
  });
});
