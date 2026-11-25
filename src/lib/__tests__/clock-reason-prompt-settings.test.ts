import {
  buildClockReasonPromptData,
  getClockDayOffset,
  parseClockReasonPromptSettings,
  shouldSkipClockReasonPrompt,
} from '../clock-reason-prompt-settings';

describe('clock reason prompt settings', () => {
  it('merges partial stored settings with defaults', () => {
    expect(
      parseClockReasonPromptSettings(JSON.stringify({ enabled: true, earlyClockInThreshold: 15 }))
    ).toEqual({
      enabled: true,
      earlyClockInThreshold: 15,
      lateClockOutThreshold: 5,
      excludeHolidays: true,
      excludeApprovedOvertime: true,
    });
  });

  it('builds early clock-in prompt data from hh:mm schedule strings', () => {
    expect(
      buildClockReasonPromptData({
        settings: {
          enabled: true,
          earlyClockInThreshold: 10,
          lateClockOutThreshold: 5,
          excludeHolidays: true,
          excludeApprovedOvertime: true,
        },
        type: 'EARLY_IN',
        scheduledTime: '09:00',
        actualTime: '08:40',
        recordId: 77,
      })
    ).toEqual({
      type: 'EARLY_IN',
      minutesDiff: 20,
      scheduledTime: '09:00',
      recordId: 77,
    });
  });

  describe('across midnight', () => {
    const settings = {
      enabled: true,
      earlyClockInThreshold: 20,
      lateClockOutThreshold: 20,
      excludeHolidays: true,
      excludeApprovedOvertime: true,
    };

    it('prompts for 30 minutes when a shift ending 23:50 is clocked out at 00:20 the next day', () => {
      expect(
        buildClockReasonPromptData({
          settings,
          type: 'LATE_OUT',
          scheduledTime: '23:50',
          actualTime: '00:20',
          recordId: 1,
          actualDayOffset: 1,
        })
      ).toEqual({ type: 'LATE_OUT', minutesDiff: 30, scheduledTime: '23:50', recordId: 1 });
    });

    it('does not prompt below the threshold on the same day', () => {
      expect(
        buildClockReasonPromptData({
          settings,
          type: 'LATE_OUT',
          scheduledTime: '18:00',
          actualTime: '18:10',
          recordId: 1,
          actualDayOffset: 0,
        })
      ).toBeNull();
    });

    it('measures a cross-midnight shift (22:00-06:00) against the end time on the next day', () => {
      const lateOut = (actualTime: string, actualDayOffset: number) =>
        buildClockReasonPromptData({
          settings,
          type: 'LATE_OUT',
          scheduledTime: '06:00',
          actualTime,
          recordId: 2,
          scheduledDayOffset: 1,
          actualDayOffset,
        });

      expect(lateOut('06:40', 1)).toMatchObject({ minutesDiff: 40 });
      // 當天 23:00 就下班，是提早下班，不是延後 17 小時
      expect(lateOut('23:00', 0)).toBeNull();
    });

    it('treats a punch before midnight as early for a shift that starts just after midnight', () => {
      expect(
        buildClockReasonPromptData({
          settings,
          type: 'EARLY_IN',
          scheduledTime: '00:30',
          actualTime: '23:50',
          recordId: 3,
          actualDayOffset: -1,
        })
      ).toMatchObject({ type: 'EARLY_IN', minutesDiff: 40 });
    });

    it('derives the day offset from the shift work date in Taipei time', () => {
      expect(getClockDayOffset('2026-11-24', new Date('2026-11-24T16:20:00.000Z'))).toBe(1); // 台北 11/25 00:20
      expect(getClockDayOffset('2026-11-24', new Date('2026-11-24T10:00:00.000Z'))).toBe(0); // 台北 11/24 18:00
      expect(getClockDayOffset('2026-11-25', new Date('2026-11-24T15:50:00.000Z'))).toBe(-1); // 台北 11/24 23:50
      expect(getClockDayOffset(undefined, new Date())).toBe(0);
    });
  });

  it('skips prompts when exclusion flags match the current day context', () => {
    expect(
      shouldSkipClockReasonPrompt({
        settings: {
          enabled: true,
          earlyClockInThreshold: 5,
          lateClockOutThreshold: 5,
          excludeHolidays: true,
          excludeApprovedOvertime: true,
        },
        isHoliday: false,
        isRestDay: false,
        hasApprovedOvertime: true,
      })
    ).toBe(true);
  });
});
