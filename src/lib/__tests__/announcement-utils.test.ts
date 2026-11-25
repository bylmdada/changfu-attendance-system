import { validateScheduledPublishBeforeExpiry } from '../announcement-utils';

describe('validateScheduledPublishBeforeExpiry', () => {
  it('accepts a publish time earlier than the expiry', () => {
    expect(validateScheduledPublishBeforeExpiry('2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z')).toBeNull();
    expect(validateScheduledPublishBeforeExpiry(new Date('2026-12-01'), new Date('2026-12-31'))).toBeNull();
  });

  it('rejects a publish time at or after the expiry', () => {
    expect(validateScheduledPublishBeforeExpiry('2026-12-02T00:00:00.000Z', '2026-12-01T00:00:00.000Z')).toContain('早於到期日');
    expect(validateScheduledPublishBeforeExpiry('2026-12-02T00:00:00.000Z', '2026-12-02T00:00:00.000Z')).toContain('早於到期日');
  });

  it('has nothing to check when either side is not set or unreadable', () => {
    expect(validateScheduledPublishBeforeExpiry(null, '2026-12-01T00:00:00.000Z')).toBeNull();
    expect(validateScheduledPublishBeforeExpiry('2026-12-01T00:00:00.000Z', null)).toBeNull();
    expect(validateScheduledPublishBeforeExpiry(undefined, undefined)).toBeNull();
    expect(validateScheduledPublishBeforeExpiry('not-a-date', '2026-12-01T00:00:00.000Z')).toBeNull();
  });
});
