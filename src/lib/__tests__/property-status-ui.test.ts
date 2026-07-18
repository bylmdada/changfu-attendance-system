import { fmtDate, fmtDateTime, taiwanDateInputValue } from '@/lib/property-status-ui';

describe('property-status-ui Taiwan date formatting', () => {
  it('formats dates and inputs using Taiwan time', () => {
    const utcLateNight = '2026-05-23T16:30:00.000Z';

    expect(fmtDate(utcLateNight)).toBe('2026-05-24');
    expect(taiwanDateInputValue(utcLateNight)).toBe('2026-05-24');
    expect(fmtDate(null)).toBe('-');
    expect(taiwanDateInputValue(null)).toBe('');
  });

  it('formats date-time values using Taiwan time', () => {
    expect(fmtDateTime('2026-05-23T16:30:00.000Z')).toContain('2026/05/24');
    expect(fmtDateTime('invalid')).toBe('-');
  });
});
