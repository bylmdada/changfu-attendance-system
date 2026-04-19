import {
  buildClockReasonPromptData,
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
