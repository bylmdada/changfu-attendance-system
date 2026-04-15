import {
  calculateAnnualLeaveDaysByTotalMonths,
  calculateAnnualLeaveDaysFromYearsOfService,
  calculateAnnualLeaveExpiryDate,
  calculateServiceDuration,
  formatYearsOfServiceInput,
} from '@/lib/annual-leave-rules';

describe('annual leave rules', () => {
  it('grants three days after six months of service', () => {
    expect(calculateAnnualLeaveDaysByTotalMonths(6)).toBe(3);
    expect(calculateAnnualLeaveDaysFromYearsOfService(0.5)).toEqual(
      expect.objectContaining({ days: 3, completedYears: 0, totalMonths: 6 }),
    );
  });

  it('keeps ten years of service at fifteen days', () => {
    expect(calculateAnnualLeaveDaysByTotalMonths(120)).toBe(15);
    expect(calculateAnnualLeaveDaysByTotalMonths(132)).toBe(16);
  });

  it('calculates anniversary expiry dates', () => {
    const expiryDate = calculateAnnualLeaveExpiryDate(new Date('2016-06-15T00:00:00.000Z'), 2026);

    expect(expiryDate.getFullYear()).toBe(2027);
    expect(expiryDate.getMonth()).toBe(5);
    expect(expiryDate.getDate()).toBe(14);
  });

  it('formats auto-filled service years with one decimal when needed', () => {
    const duration = calculateServiceDuration(
      new Date('2025-06-15T00:00:00.000Z'),
      new Date('2025-12-31T00:00:00.000Z'),
    );

    expect(duration.totalMonths).toBe(6);
    expect(formatYearsOfServiceInput(duration.totalMonths)).toBe('0.5');
  });
});