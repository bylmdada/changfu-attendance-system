export interface ServiceDuration {
  years: number;
  months: number;
  totalMonths: number;
}

export function calculateServiceDuration(
  hireDate: Date,
  referenceDate: Date = new Date(),
): ServiceDuration {
  const hire = new Date(hireDate);
  const reference = new Date(referenceDate);

  let years = reference.getFullYear() - hire.getFullYear();
  let months = reference.getMonth() - hire.getMonth();

  if (reference.getDate() < hire.getDate()) {
    months -= 1;
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) {
    years = 0;
    months = 0;
  }

  return {
    years,
    months,
    totalMonths: years * 12 + months,
  };
}

export function calculateAnnualLeaveDaysByTotalMonths(totalMonths: number): number {
  const normalizedMonths = Math.max(0, Math.floor(totalMonths));
  const completedYears = Math.floor(normalizedMonths / 12);

  if (normalizedMonths < 6) return 0;
  if (normalizedMonths < 12) return 3;
  if (completedYears < 2) return 7;
  if (completedYears < 3) return 10;
  if (completedYears < 5) return 14;
  if (completedYears < 10) return 15;

  return Math.min(30, 15 + (completedYears - 10));
}

export function calculateAnnualLeaveDaysFromYearsOfService(yearsOfService: number) {
  const normalizedYears = Math.max(0, yearsOfService);
  const totalMonths = Math.floor(normalizedYears * 12);

  return {
    totalMonths,
    completedYears: Math.floor(totalMonths / 12),
    days: calculateAnnualLeaveDaysByTotalMonths(totalMonths),
  };
}

export function calculateAnnualLeaveEntitlement(
  hireDate: Date,
  referenceDate: Date = new Date(),
) {
  const serviceDuration = calculateServiceDuration(hireDate, referenceDate);

  return {
    ...serviceDuration,
    days: calculateAnnualLeaveDaysByTotalMonths(serviceDuration.totalMonths),
  };
}

export function calculateAnnualLeaveExpiryDate(hireDate: Date, year: number): Date {
  return new Date(year + 1, hireDate.getMonth(), hireDate.getDate() - 1);
}

export function formatYearsOfServiceInput(totalMonths: number): string {
  const normalizedMonths = Math.max(0, Math.floor(totalMonths));
  const years = normalizedMonths / 12;

  if (Number.isInteger(years)) {
    return String(years);
  }

  return (Math.round(years * 10) / 10).toFixed(1).replace(/\.0$/, '');
}