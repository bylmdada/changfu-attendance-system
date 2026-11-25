jest.mock('@/lib/database', () => ({
  prisma: {
    employee: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '@/lib/database';
import { calculateAllEmployeesAnnualLeave, saveAnnualLeaveEntitlement } from '../annual-leave-calculator';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

// 一個用記憶體模擬 annual_leaves 與歷程的交易用戶端
function makeStore(initial: { totalDays: number; usedDays: number; remainingDays: number } | null) {
  const state = { row: initial ? { ...initial } : null as null | { totalDays: number; usedDays: number; remainingDays: number }, history: [] as Array<Record<string, unknown>> };
  const tx = {
    annualLeave: {
      findUnique: jest.fn(async () => (state.row ? { usedDays: state.row.usedDays } : null)),
      upsert: jest.fn(async ({ create, update }: { create: Record<string, number>; update: Record<string, number> }) => {
        state.row = state.row
          ? { ...state.row, totalDays: update.totalDays, remainingDays: update.remainingDays }
          : { totalDays: create.totalDays, usedDays: create.usedDays, remainingDays: create.remainingDays };
      }),
    },
    leaveBalanceHistory: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { state.history.push(data); }),
    },
  };
  return { state, tx };
}

describe('saveAnnualLeaveEntitlement', () => {
  const params = { employeeId: 7, year: 2026, yearsOfService: 2, totalDays: 10, expiryDate: new Date('2027-03-01'), note: '年資 2 年' };

  it('keeps the used days and recomputes the remaining days, running it twice changes nothing more', async () => {
    const { state, tx } = makeStore({ totalDays: 10, usedDays: 4, remainingDays: 6 });

    await saveAnnualLeaveEntitlement(tx as never, params);
    await saveAnnualLeaveEntitlement(tx as never, params);

    expect(state.row).toEqual({ totalDays: 10, usedDays: 4, remainingDays: 6 }); // 不是 10／4／10
    expect(state.history).toHaveLength(2);
    expect(state.history[1]).toEqual(expect.objectContaining({ entitled: 10, used: 4, remaining: 6, source: 'SYSTEM_CALC' }));
  });

  it('moves the remaining days together with a corrected total (used stays)', async () => {
    const { state, tx } = makeStore({ totalDays: 15, usedDays: 4, remainingDays: 11 });

    await saveAnnualLeaveEntitlement(tx as never, { ...params, totalDays: 16 });

    expect(state.row).toEqual({ totalDays: 16, usedDays: 4, remainingDays: 12 });
  });

  it('creates a fresh record with nothing used', async () => {
    const { state, tx } = makeStore(null);

    await saveAnnualLeaveEntitlement(tx as never, params);

    expect(state.row).toEqual({ totalDays: 10, usedDays: 0, remainingDays: 10 });
    expect(state.history[0]).toEqual(expect.objectContaining({ used: 0, remaining: 10 }));
  });
});

describe('calculateAllEmployeesAnnualLeave', () => {
  it('re-running the company-wide calculation does not give the used days back', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { state, tx } = makeStore({ totalDays: 10, usedDays: 4, remainingDays: 6 });
    // 2024-03-01 到職，2026 年底年資 2 年 9 個月 → 法定 10 天
    mockPrisma.employee.findMany.mockResolvedValue([{ id: 7, name: '王小明', hireDate: new Date(2024, 2, 1) }] as never);
    mockPrisma.$transaction.mockImplementation((async (callback: (t: unknown) => unknown) => callback(tx)) as never);

    const first = await calculateAllEmployeesAnnualLeave(2026);
    const second = await calculateAllEmployeesAnnualLeave(2026);

    expect(first.success).toBe(1);
    expect(second.success).toBe(1);
    expect(state.row).toEqual({ totalDays: 10, usedDays: 4, remainingDays: 6 });
    expect(state.history.every((entry) => entry.used === 4 && entry.remaining === 6)).toBe(true);
  });
});
