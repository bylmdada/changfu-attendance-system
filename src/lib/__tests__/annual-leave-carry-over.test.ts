import {
  DEFAULT_CARRY_OVER_POLICY,
  getCarryOverStatus,
  getUsableCarryOverDays,
  readAnnualLeaveCarryOverPolicy,
} from '../annual-leave-carry-over';

const on = new Date('2026-04-19T00:00:00.000Z');
const valid = { remainingDays: 2, expiryDate: new Date('2026-06-14T00:00:00.000Z') };
const expired = { remainingDays: 2, expiryDate: new Date('2026-03-31T00:00:00.000Z') };
const allowed = { enabled: true, maxDays: 0 };

describe('carry-over status and usable days', () => {
  it('is usable only when rollover is allowed and the last-year balance has not expired', () => {
    expect(getCarryOverStatus(valid, allowed, on)).toBe('USABLE');
    expect(getUsableCarryOverDays(valid, allowed, on)).toBe(2);
  });

  it('keeps an expired balance as history that cannot be spent', () => {
    expect(getCarryOverStatus(expired, allowed, on)).toBe('EXPIRED');
    expect(getUsableCarryOverDays(expired, allowed, on)).toBe(0);
  });

  it('keeps the balance as history when the company does not allow rollover (the default)', () => {
    expect(DEFAULT_CARRY_OVER_POLICY.enabled).toBe(false);
    expect(getCarryOverStatus(valid, DEFAULT_CARRY_OVER_POLICY, on)).toBe('NOT_ENABLED');
    expect(getUsableCarryOverDays(valid, DEFAULT_CARRY_OVER_POLICY, on)).toBe(0);
  });

  it('applies the rollover cap (0 means no cap)', () => {
    expect(getUsableCarryOverDays({ ...valid, remainingDays: 5 }, { enabled: true, maxDays: 3 }, on)).toBe(3);
    expect(getUsableCarryOverDays({ ...valid, remainingDays: 2 }, { enabled: true, maxDays: 3 }, on)).toBe(2);
    expect(getUsableCarryOverDays({ ...valid, remainingDays: 5 }, { enabled: true, maxDays: 0 }, on)).toBe(5);
  });

  it('has nothing to show when nothing is left or there is no record', () => {
    expect(getCarryOverStatus({ ...valid, remainingDays: 0 }, allowed, on)).toBeNull();
    expect(getCarryOverStatus(null, allowed, on)).toBeNull();
    expect(getUsableCarryOverDays(undefined, allowed, on)).toBe(0);
  });
});

describe('readAnnualLeaveCarryOverPolicy', () => {
  it('reads the active leave rules config', async () => {
    const client = { leaveRulesConfig: { findFirst: jest.fn().mockResolvedValue({ annualLeaveRollover: true, annualLeaveRolloverMax: 5 }) } };
    await expect(readAnnualLeaveCarryOverPolicy(client as never)).resolves.toEqual({ enabled: true, maxDays: 5 });
    expect(client.leaveRulesConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, effectiveDate: { lte: expect.any(Date) } },
    }));
  });

  it('falls back to "not allowed" without a config row or without the table client', async () => {
    const empty = { leaveRulesConfig: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(readAnnualLeaveCarryOverPolicy(empty as never)).resolves.toEqual(DEFAULT_CARRY_OVER_POLICY);
    await expect(readAnnualLeaveCarryOverPolicy({} as never)).resolves.toEqual(DEFAULT_CARRY_OVER_POLICY);
  });
});
