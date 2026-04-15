import { planCompLeaveImportRepair } from '@/lib/comp-leave-import-repair';

describe('planCompLeaveImportRepair', () => {
  it('keeps the latest import baseline, deletes older import rows, and recomputes from the latest baseline forward', () => {
    const result = planCompLeaveImportRepair([
      {
        id: 1,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 8,
        isFrozen: true,
        referenceType: 'IMPORT',
        yearMonth: '2026-03',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        id: 2,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 3,
        isFrozen: true,
        referenceType: 'OVERTIME',
        yearMonth: '2026-03',
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
      },
      {
        id: 3,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 12,
        isFrozen: true,
        referenceType: 'IMPORT',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      },
      {
        id: 4,
        employeeId: 9,
        transactionType: 'USE',
        hours: 2,
        isFrozen: true,
        referenceType: 'LEAVE',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-03T00:00:00.000Z'),
      },
      {
        id: 5,
        employeeId: 9,
        transactionType: 'EARN',
        hours: 1,
        isFrozen: true,
        referenceType: 'OVERTIME',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-05T00:00:00.000Z'),
      },
      {
        id: 6,
        employeeId: 9,
        transactionType: 'USE',
        hours: 0.5,
        isFrozen: false,
        referenceType: 'LEAVE',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-06T00:00:00.000Z'),
      },
    ]);

    expect(result.employeeId).toBe(9);
    expect(result.latestImportBaselineId).toBe(3);
    expect(result.deleteImportIds).toEqual([1]);
    expect(result.hasDuplicateImports).toBe(true);
    expect(result.recomputedBalance).toEqual({
      totalEarned: 13,
      totalUsed: 2,
      balance: 11,
      pendingEarn: 0,
      pendingUse: 0.5,
    });
  });

  it('returns no cleanup work when there is only one import baseline', () => {
    const result = planCompLeaveImportRepair([
      {
        id: 10,
        employeeId: 7,
        transactionType: 'EARN',
        hours: 5,
        isFrozen: true,
        referenceType: 'IMPORT',
        yearMonth: '2026-04',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);

    expect(result.employeeId).toBe(7);
    expect(result.latestImportBaselineId).toBe(10);
    expect(result.deleteImportIds).toEqual([]);
    expect(result.hasDuplicateImports).toBe(false);
    expect(result.recomputedBalance).toEqual({
      totalEarned: 5,
      totalUsed: 0,
      balance: 5,
      pendingEarn: 0,
      pendingUse: 0,
    });
  });
});