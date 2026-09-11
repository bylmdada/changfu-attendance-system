jest.mock('@/lib/database', () => ({
  prisma: {
    salaryHistory: {
      findFirst: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
  },
}));

import { calculateHourlyRate, calculateOvertimePay } from '@/lib/salary-utils';
import { calculateMonthlySalaryHourlyRate } from '@/lib/hourly-rate';

describe('salary-utils hourly rate', () => {
  it('rounds monthly salary divided by 240 to the nearest integer', () => {
    expect(calculateHourlyRate(45000)).toBe(188);
    expect(calculateHourlyRate(50600)).toBe(211);
    expect(calculateMonthlySalaryHourlyRate(40100)).toBe(167);
  });
});

describe('salary-utils overtime rates', () => {
  it('uses exact legal weekday fractions instead of decimal approximations', () => {
    expect(calculateOvertimePay(150, 2, 'WEEKDAY')).toBe(400);
    expect(calculateOvertimePay(150, 4, 'WEEKDAY')).toBe(900);
  });

  it('uses exact legal rest-day fractions instead of decimal approximations', () => {
    expect(calculateOvertimePay(150, 8, 'REST_DAY')).toBe(1900);
    expect(calculateOvertimePay(150, 10, 'REST_DAY')).toBe(2700);
  });

  it('uses the holiday rate for exceptional work on a mandatory rest day', () => {
    expect(calculateOvertimePay(150, 2, 'MANDATORY_REST')).toBe(600);
  });
});
