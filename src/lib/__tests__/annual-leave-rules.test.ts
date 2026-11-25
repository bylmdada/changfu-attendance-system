import {
  calculateAnnualLeaveDaysByTotalMonths,
  calculateAnnualLeaveDaysFromYearsOfService,
  calculateAnnualLeaveExpiryDate,
  calculateServiceDuration,
  formatYearsOfServiceInput,
  recalculateAnnualLeaveBalance,
} from '@/lib/annual-leave-rules';

describe('annual leave rules', () => {
  it('grants three days after six months of service', () => {
    expect(calculateAnnualLeaveDaysByTotalMonths(6)).toBe(3);
    expect(calculateAnnualLeaveDaysFromYearsOfService(0.5)).toEqual(
      expect.objectContaining({ days: 3, completedYears: 0, totalMonths: 6 }),
    );
  });

  it('follows the Ministry of Labor table from five years on', () => {
    // 滿 5～9 年 15 日；滿 10 年起每年加 1 日（10 年 16 日），24 年起維持 30 日上限
    expect(calculateAnnualLeaveDaysByTotalMonths(60)).toBe(15);
    expect(calculateAnnualLeaveDaysByTotalMonths(108)).toBe(15); // 9 年
    expect(calculateAnnualLeaveDaysByTotalMonths(119)).toBe(15); // 9 年 11 個月
    expect(calculateAnnualLeaveDaysByTotalMonths(120)).toBe(16); // 10 年
    expect(calculateAnnualLeaveDaysByTotalMonths(132)).toBe(17); // 11 年
    expect(calculateAnnualLeaveDaysByTotalMonths(12 * 23)).toBe(29);
    expect(calculateAnnualLeaveDaysByTotalMonths(12 * 24)).toBe(30);
    expect(calculateAnnualLeaveDaysByTotalMonths(12 * 25)).toBe(30);
    expect(calculateAnnualLeaveDaysByTotalMonths(12 * 40)).toBe(30);
  });

  it('gives each earlier tier its legal days', () => {
    expect(calculateAnnualLeaveDaysByTotalMonths(5)).toBe(0);
    expect(calculateAnnualLeaveDaysByTotalMonths(11)).toBe(3);
    expect(calculateAnnualLeaveDaysByTotalMonths(12)).toBe(7);
    expect(calculateAnnualLeaveDaysByTotalMonths(24)).toBe(10);
    expect(calculateAnnualLeaveDaysByTotalMonths(36)).toBe(14);
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
describe('recalculateAnnualLeaveBalance', () => {
  it('keeps the days already used and recomputes the remaining days', () => {
    expect(recalculateAnnualLeaveBalance(4, 10)).toEqual({ totalDays: 10, usedDays: 4, remainingDays: 6 });
    expect(recalculateAnnualLeaveBalance(4.5, 10)).toEqual({ totalDays: 10, usedDays: 4.5, remainingDays: 5.5 });
  });

  it('treats a missing record as nothing used', () => {
    expect(recalculateAnnualLeaveBalance(undefined, 7)).toEqual({ totalDays: 7, usedDays: 0, remainingDays: 7 });
    expect(recalculateAnnualLeaveBalance(null, 7)).toEqual({ totalDays: 7, usedDays: 0, remainingDays: 7 });
  });

  it('never goes negative when more was used than the new total, and avoids float noise', () => {
    expect(recalculateAnnualLeaveBalance(12, 10).remainingDays).toBe(0);
    expect(recalculateAnnualLeaveBalance(0.1 + 0.2, 1).remainingDays).toBe(0.7);
  });
});
