import type { CompLeaveBalanceSnapshot, CompLeaveImportRepairPlan } from '@/lib/comp-leave-import-repair';

export type RepairCompLeaveJsonReportStatus = 'no-data' | 'no-duplicates' | 'needs-repair';

export type RepairCompLeaveJsonPlan = Pick<
  CompLeaveImportRepairPlan,
  'employeeId' | 'latestImportBaselineId' | 'deleteImportIds' | 'recomputedBalance'
>;

export type RepairCompLeaveJsonReport = {
  mode: 'dry-run';
  status: RepairCompLeaveJsonReportStatus;
  target: {
    path: string;
    source: string;
  };
  filter: {
    employeeId: number | null;
  };
  summary: {
    affectedEmployees: number;
    deleteImportCount: number;
  };
  plans: Array<{
    employeeId: number;
    latestImportBaselineId: number | null;
    deleteImportIds: number[];
    recomputedBalance: CompLeaveBalanceSnapshot;
  }>;
};

type BuildRepairCompLeaveJsonReportArgs = {
  targetLabel: string;
  targetSourceLabel: string;
  employeeIdFilter: number | null;
  status: RepairCompLeaveJsonReportStatus;
  plans: RepairCompLeaveJsonPlan[];
};

export function buildRepairCompLeaveJsonReport({
  targetLabel,
  targetSourceLabel,
  employeeIdFilter,
  status,
  plans,
}: BuildRepairCompLeaveJsonReportArgs): RepairCompLeaveJsonReport {
  return {
    mode: 'dry-run',
    status,
    target: {
      path: targetLabel,
      source: targetSourceLabel,
    },
    filter: {
      employeeId: employeeIdFilter,
    },
    summary: {
      affectedEmployees: plans.length,
      deleteImportCount: plans.reduce((sum, plan) => sum + plan.deleteImportIds.length, 0),
    },
    plans: plans.map(plan => ({
      employeeId: plan.employeeId,
      latestImportBaselineId: plan.latestImportBaselineId,
      deleteImportIds: [...plan.deleteImportIds],
      recomputedBalance: { ...plan.recomputedBalance },
    })),
  };
}