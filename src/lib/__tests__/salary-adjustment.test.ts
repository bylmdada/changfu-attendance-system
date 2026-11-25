jest.mock('@/lib/database', () => {
  const tx = {
    employee: { findUnique: jest.fn(), update: jest.fn() },
    salaryHistory: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  return { prisma: { $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)), __tx: tx } };
});

import { prisma } from '@/lib/database';
import { adjustSalary } from '@/lib/salary-utils';

type Tx = {
  employee: { findUnique: jest.Mock; update: jest.Mock };
  salaryHistory: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
};
const tx = (prisma as unknown as { __tx: Tx }).__tx;

const seed = ({ current = 42000, earlier, later }: {
  current?: number;
  earlier?: { baseSalary: number };
  later?: { id: number; effectiveDate: Date; baseSalary: number };
}) => {
  tx.employee.findUnique.mockResolvedValue({ baseSalary: current });
  tx.salaryHistory.findFirst.mockImplementation(async ({ where }: { where: { effectiveDate: Record<string, Date> } }) =>
    ('lte' in where.effectiveDate ? earlier ?? null : later ?? null));
  tx.salaryHistory.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 99, ...data }));
};

const adjust = (effectiveDate: string, newBaseSalary: number) => adjustSalary({
  employeeId: 7,
  effectiveDate: new Date(effectiveDate),
  newBaseSalary,
  adjustmentType: 'ADJUSTMENT',
  approvedById: 1,
});

describe('salary adjustment ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-25T04:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the current salary when an older date is back-filled while a later effective record exists', async () => {
    // 主檔現薪 42,000（2026-05-01 生效），補登 2026-01-01 的 39,000
    seed({
      earlier: { baseSalary: 36000 },
      later: { id: 5, effectiveDate: new Date('2026-05-01'), baseSalary: 42000 },
    });

    const result = await adjust('2026-01-01', 39000);

    expect(result).toMatchObject({ success: true, previousSalary: 36000, adjustmentAmount: 3000, currentSalaryUpdated: false });
    expect(tx.employee.update).not.toHaveBeenCalled(); // 現薪仍是 42,000
    expect(tx.salaryHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ baseSalary: 39000, previousSalary: 36000, adjustmentAmount: 3000 }) });
    // 後面那筆的前薪與調幅改以補登的 39,000 為基準
    expect(tx.salaryHistory.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { previousSalary: 39000, adjustmentAmount: 3000 } });
  });

  it('takes the previous salary from the record before the effective date, not from the employee record', async () => {
    seed({ current: 50000, earlier: { baseSalary: 40000 } });

    const result = await adjust('2026-11-01', 45000);

    expect(result).toMatchObject({ previousSalary: 40000, adjustmentAmount: 5000, currentSalaryUpdated: true });
    expect(tx.employee.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { baseSalary: 45000, hourlyRate: 188 } });
    expect(tx.salaryHistory.update).not.toHaveBeenCalled();
  });

  it('uses the employee current salary as the previous salary only when there is no history at all', async () => {
    seed({ current: 42000 });

    const result = await adjust('2026-11-25', 44000);

    expect(result).toMatchObject({ previousSalary: 42000, adjustmentAmount: 2000, currentSalaryUpdated: true });
  });

  it('leaves the previous salary unknown when back-filling before the very first record', async () => {
    seed({ later: { id: 2, effectiveDate: new Date('2025-01-01'), baseSalary: 36000 } });

    const result = await adjust('2024-06-01', 33000);

    expect(result).toMatchObject({ previousSalary: null, adjustmentAmount: null, currentSalaryUpdated: false });
    expect(tx.salaryHistory.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { previousSalary: 33000, adjustmentAmount: 3000 } });
  });

  it('does not change the current salary for a future-dated adjustment', async () => {
    seed({ earlier: { baseSalary: 42000 } });

    const result = await adjust('2027-01-01', 46000);

    expect(result).toMatchObject({ previousSalary: 42000, currentSalaryUpdated: false });
    expect(tx.employee.update).not.toHaveBeenCalled();
  });

  it('still updates the current salary when the only later record is not effective yet', async () => {
    seed({
      earlier: { baseSalary: 42000 },
      later: { id: 8, effectiveDate: new Date('2027-01-01'), baseSalary: 46000 },
    });

    const result = await adjust('2026-11-01', 43000);

    expect(result).toMatchObject({ currentSalaryUpdated: true });
    expect(tx.employee.update).toHaveBeenCalled();
    expect(tx.salaryHistory.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { previousSalary: 43000, adjustmentAmount: 3000 } });
  });

  it('writes nothing when the employee does not exist', async () => {
    tx.employee.findUnique.mockResolvedValue(null);

    const result = await adjust('2026-11-01', 45000);

    expect(result).toEqual({ success: false, error: '找不到員工' });
    expect(tx.salaryHistory.create).not.toHaveBeenCalled();
  });
});
