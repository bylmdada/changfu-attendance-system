jest.mock('@/lib/database', () => ({
  prisma: {
    bonusConfiguration: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/database';
import { calculateBonusForPayrollMonth } from '../payroll-processing';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('payroll processing bonus eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('counts calendar service months correctly for month-end hires', async () => {
    mockPrisma.bonusConfiguration.findMany.mockResolvedValue([
      {
        bonusType: 'FESTIVAL',
        eligibilityRules: {
          minimumServiceMonths: 15,
          festivalMultipliers: {
            spring_festival: 1,
          },
        },
        paymentSchedule: {
          springMonth: 4,
        },
      },
    ] as never);

    const result = await calculateBonusForPayrollMonth(
      {
        id: 1,
        baseSalary: 30000,
        hireDate: new Date('2024-01-31T00:00:00.000Z'),
      },
      2025,
      4
    );

    expect(result.festivalBonus).toBe(30000);
    expect(result.totalBonus).toBe(30000);
  });
});
