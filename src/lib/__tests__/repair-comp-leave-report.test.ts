import { buildRepairCompLeaveJsonReport } from '@/lib/repair-comp-leave-report';

describe('buildRepairCompLeaveJsonReport', () => {
  it('builds a structured dry-run report with summary counts', () => {
    const report = buildRepairCompLeaveJsonReport({
      targetLabel: '/tmp/prod-snapshot.db',
      targetSourceLabel: '命令列參數',
      employeeIdFilter: null,
      status: 'needs-repair',
      plans: [
        {
          employeeId: 7,
          latestImportBaselineId: 30,
          deleteImportIds: [12, 18],
          recomputedBalance: {
            balance: 8,
            totalEarned: 16,
            totalUsed: 8,
            pendingEarn: 0,
            pendingUse: 0,
          },
        },
      ],
    });

    expect(report.mode).toBe('dry-run');
    expect(report.target.path).toBe('/tmp/prod-snapshot.db');
    expect(report.target.source).toBe('命令列參數');
    expect(report.summary.affectedEmployees).toBe(1);
    expect(report.summary.deleteImportCount).toBe(2);
    expect(report.plans[0]).toEqual({
      employeeId: 7,
      latestImportBaselineId: 30,
      deleteImportIds: [12, 18],
      recomputedBalance: {
        balance: 8,
        totalEarned: 16,
        totalUsed: 8,
        pendingEarn: 0,
        pendingUse: 0,
      },
    });
  });

  it('keeps empty plan lists for no-data style dry-runs', () => {
    const report = buildRepairCompLeaveJsonReport({
      targetLabel: 'file:./prisma/dev.db',
      targetSourceLabel: 'fallback',
      employeeIdFilter: 42,
      status: 'no-data',
      plans: [],
    });

    expect(report.status).toBe('no-data');
    expect(report.filter.employeeId).toBe(42);
    expect(report.summary.affectedEmployees).toBe(0);
    expect(report.summary.deleteImportCount).toBe(0);
    expect(report.plans).toEqual([]);
  });
});