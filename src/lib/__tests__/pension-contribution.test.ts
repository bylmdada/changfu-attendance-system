import {
  calculatePensionContributionEffectiveDate,
  getEffectivePensionContributionRate,
  getTaiwanMonthStartUtc,
} from '@/lib/pension-contribution';

describe('pension contribution helpers', () => {
  it('sets applications submitted on or before the 25th to next month', () => {
    const effectiveDate = calculatePensionContributionEffectiveDate(new Date('2026-01-25T15:30:00.000Z'));
    expect(effectiveDate.toISOString()).toBe('2026-01-31T16:00:00.000Z');
  });

  it('sets applications submitted after the 25th to the following month', () => {
    const effectiveDate = calculatePensionContributionEffectiveDate(new Date('2026-01-26T01:00:00.000Z'));
    expect(effectiveDate.toISOString()).toBe('2026-02-28T16:00:00.000Z');
  });

  it('resolves the latest approved rate effective before the requested boundary', async () => {
    const findFirst = jest.fn().mockResolvedValue({ requestedRate: 3.5 });

    const rate = await getEffectivePensionContributionRate(
      { findFirst },
      10,
      1,
      getTaiwanMonthStartUtc(2026, 5)
    );

    expect(rate).toBe(3.5);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: 10,
        status: 'APPROVED',
        effectiveDate: {
          lt: new Date('2026-04-30T16:00:00.000Z'),
        },
      },
      orderBy: [
        { effectiveDate: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      select: {
        requestedRate: true,
      },
    });
  });
});
