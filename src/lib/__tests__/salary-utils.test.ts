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

import { calculateOvertimePay } from '@/lib/salary-utils';

describe('salary-utils overtime rates', () => {
  it('uses exact legal weekday fractions instead of decimal approximations', () => {
    expect(calculateOvertimePay(150, 2, 'WEEKDAY')).toBe(400);
    expect(calculateOvertimePay(150, 4, 'WEEKDAY')).toBe(900);
  });

  it('uses exact legal rest-day fractions instead of decimal approximations', () => {
    expect(calculateOvertimePay(150, 8, 'REST_DAY')).toBe(1900);
    expect(calculateOvertimePay(150, 10, 'REST_DAY')).toBe(2700);
  });
});
