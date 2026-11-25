jest.mock('@/lib/database', () => ({ prisma: {} }));
import { applyApprovedLeaveAccounting, reverseApprovedAnnualLeaveAccounting } from '@/lib/annual-leave-schedule-accounting';

type Row = { remainingDays: number; usedDays: number; expiryDate: Date };

// 一個用記憶體模擬 annual_leaves 的交易用戶端（updateMany 比對 remainingDays >= days 才扣，與資料庫行為相同）
function makeTx(rows: Record<number, Row>, rollover: { enabled: boolean; max: number } | null) {
  const snapshots: string[] = [];
  const tx = {
    schedule: {
      findMany: jest.fn().mockResolvedValue([{ workDate: '2026-03-02', startTime: '00:00', endTime: '08:00', breakTime: 0, workHours: 8 }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ specialLeaveHours: 8 }),
      update: jest.fn(),
    },
    annualLeave: {
      findUnique: jest.fn(async ({ where }: { where: { employeeId_year: { year: number } } }) => rows[where.employeeId_year.year] ?? null),
      updateMany: jest.fn(async ({ where, data }: {
        where: { year: number; remainingDays?: { gte: number } };
        data: { usedDays: { increment?: number; decrement?: number }; remainingDays: { increment?: number; decrement?: number } };
      }) => {
        const row = rows[where.year];
        if (!row) return { count: 0 };
        if (where.remainingDays && row.remainingDays + 1e-9 < where.remainingDays.gte) return { count: 0 };
        const change = (data.remainingDays.increment ?? 0) - (data.remainingDays.decrement ?? 0);
        row.remainingDays = Math.round((row.remainingDays + change) * 10000) / 10000;
        row.usedDays = Math.round((row.usedDays - change) * 10000) / 10000;
        return { count: 1 };
      }),
    },
    leaveRulesConfig: {
      findFirst: jest.fn().mockResolvedValue(rollover ? { annualLeaveRollover: rollover.enabled, annualLeaveRolloverMax: rollover.max } : null),
    },
    leaveRequest: { update: jest.fn(async ({ data }: { data: { annualLeaveAccounting: string } }) => { snapshots.push(data.annualLeaveAccounting); }) },
  };
  return { tx, snapshots };
}

// 2026-03-02 全天（8 小時 = 1 天）
const leave = {
  id: 1,
  employeeId: 10,
  leaveType: 'ANNUAL',
  startDate: new Date('2026-03-02T00:00:00+08:00'),
  endDate: new Date('2026-03-02T08:00:00+08:00'),
};
const lastYearRow = (remainingDays: number, expiry = '2026-06-14T00:00:00.000Z'): Row => ({ remainingDays, usedDays: 0, expiryDate: new Date(expiry) });

describe('annual leave approval that falls back to unexpired carry-over', () => {
  it('uses last year when this year is empty and rollover is on, and reverses back to last year', async () => {
    const rows: Record<number, Row> = { 2026: { remainingDays: 0, usedDays: 10, expiryDate: new Date('2027-03-01') }, 2025: lastYearRow(2) };
    const { tx, snapshots } = makeTx(rows, { enabled: true, max: 0 });

    await applyApprovedLeaveAccounting(tx as never, leave);

    expect(rows[2026]).toEqual(expect.objectContaining({ remainingDays: 0, usedDays: 10 }));
    expect(rows[2025]).toEqual(expect.objectContaining({ remainingDays: 1, usedDays: 1 }));
    expect(JSON.parse(snapshots[0])).toEqual({ hoursByDate: { '2026-03-02': 8 }, deductions: [{ year: 2025, days: 1 }] });

    await reverseApprovedAnnualLeaveAccounting(tx as never, { ...leave, annualLeaveAccounting: snapshots[0] });

    expect(rows[2025]).toEqual(expect.objectContaining({ remainingDays: 2, usedDays: 0 })); // 還回原來扣的去年度
    expect(rows[2026]).toEqual(expect.objectContaining({ remainingDays: 0, usedDays: 10 })); // 沒有誤還到今年度
  });

  it('splits across years when this year only has part of the days, and gives both parts back', async () => {
    const rows: Record<number, Row> = { 2026: { remainingDays: 0.5, usedDays: 9.5, expiryDate: new Date('2027-03-01') }, 2025: lastYearRow(2) };
    const { tx, snapshots } = makeTx(rows, { enabled: true, max: 0 });

    await applyApprovedLeaveAccounting(tx as never, leave);

    expect(rows[2026].remainingDays).toBe(0);
    expect(rows[2025].remainingDays).toBe(1.5);
    expect(JSON.parse(snapshots[0]).deductions).toEqual([{ year: 2026, days: 0.5 }, { year: 2025, days: 0.5 }]);

    await reverseApprovedAnnualLeaveAccounting(tx as never, { ...leave, annualLeaveAccounting: snapshots[0] });

    expect(rows[2026]).toEqual(expect.objectContaining({ remainingDays: 0.5, usedDays: 9.5 }));
    expect(rows[2025]).toEqual(expect.objectContaining({ remainingDays: 2, usedDays: 0 }));
  });

  it('still says the balance is insufficient when rollover is not allowed (the default)', async () => {
    const rows: Record<number, Row> = { 2026: { remainingDays: 0, usedDays: 10, expiryDate: new Date('2027-03-01') }, 2025: lastYearRow(2) };

    await expect(applyApprovedLeaveAccounting(makeTx(rows, null).tx as never, leave)).rejects.toThrow('特休餘額不足');
    await expect(applyApprovedLeaveAccounting(makeTx(rows, { enabled: false, max: 0 }).tx as never, leave)).rejects.toThrow('特休餘額不足');
    expect(rows[2025].remainingDays).toBe(2);
  });

  it('does not touch an expired last-year balance', async () => {
    const rows: Record<number, Row> = { 2026: { remainingDays: 0, usedDays: 10, expiryDate: new Date('2027-03-01') }, 2025: lastYearRow(2, '2026-01-31T00:00:00.000Z') };

    await expect(applyApprovedLeaveAccounting(makeTx(rows, { enabled: true, max: 0 }).tx as never, leave)).rejects.toThrow('特休餘額不足');
    expect(rows[2025].remainingDays).toBe(2);
  });

  it('respects the rollover cap: only the capped days can be used', async () => {
    const rows: Record<number, Row> = { 2026: { remainingDays: 0, usedDays: 10, expiryDate: new Date('2027-03-01') }, 2025: lastYearRow(5) };
    // 上限 0.5 天，但這張假要 1 天
    await expect(applyApprovedLeaveAccounting(makeTx(rows, { enabled: true, max: 0.5 }).tx as never, leave)).rejects.toThrow('特休餘額不足');
    expect(rows[2025].remainingDays).toBe(5);
  });

  it('keeps the plain snapshot format when this year has enough days (older code can still reverse it)', async () => {
    const rows: Record<number, Row> = { 2026: { remainingDays: 5, usedDays: 5, expiryDate: new Date('2027-03-01') }, 2025: lastYearRow(2) };
    const { tx, snapshots } = makeTx(rows, { enabled: true, max: 0 });

    await applyApprovedLeaveAccounting(tx as never, leave);

    expect(rows[2026].remainingDays).toBe(4);
    expect(rows[2025].remainingDays).toBe(2);
    expect(JSON.parse(snapshots[0])).toEqual({ '2026-03-02': 8 });
    await reverseApprovedAnnualLeaveAccounting(tx as never, { ...leave, annualLeaveAccounting: snapshots[0] });
    expect(rows[2026].remainingDays).toBe(5);
  });
});
