export type CompLeaveRepairTransaction = {
  id: number;
  employeeId: number;
  transactionType: string;
  hours: number;
  isFrozen: boolean;
  referenceType: string | null;
  yearMonth: string;
  createdAt: Date;
};

export type CompLeaveBalanceSnapshot = {
  totalEarned: number;
  totalUsed: number;
  balance: number;
  pendingEarn: number;
  pendingUse: number;
};

export type CompLeaveImportRepairPlan = {
  employeeId: number;
  latestImportBaselineId: number | null;
  deleteImportIds: number[];
  hasDuplicateImports: boolean;
  recomputedBalance: CompLeaveBalanceSnapshot;
};

function isImportBaseline(transaction: CompLeaveRepairTransaction) {
  return transaction.transactionType === 'EARN' && transaction.referenceType === 'IMPORT';
}

function sortByNewest(left: CompLeaveRepairTransaction, right: CompLeaveRepairTransaction) {
  const timeDiff = right.createdAt.getTime() - left.createdAt.getTime();
  if (timeDiff !== 0) {
    return timeDiff;
  }

  return right.id - left.id;
}

function isAfterBaseline(
  transaction: CompLeaveRepairTransaction,
  baseline: CompLeaveRepairTransaction | null
) {
  if (!baseline) {
    return true;
  }

  const transactionTime = transaction.createdAt.getTime();
  const baselineTime = baseline.createdAt.getTime();

  if (transactionTime !== baselineTime) {
    return transactionTime > baselineTime;
  }

  return transaction.id > baseline.id;
}

function calculateBalanceSnapshot(
  transactions: CompLeaveRepairTransaction[],
  latestImportBaseline: CompLeaveRepairTransaction | null
): CompLeaveBalanceSnapshot {
  const frozenTransactions = transactions.filter(transaction => transaction.isFrozen);
  const pendingTransactions = transactions.filter(transaction => !transaction.isFrozen);

  const effectiveFrozenTransactions = latestImportBaseline
    ? frozenTransactions.filter(transaction => {
        if (transaction.id === latestImportBaseline.id) {
          return true;
        }

        if (transaction.referenceType === 'IMPORT') {
          return false;
        }

        return isAfterBaseline(transaction, latestImportBaseline);
      })
    : frozenTransactions;

  const effectivePendingTransactions = latestImportBaseline
    ? pendingTransactions.filter(transaction => isAfterBaseline(transaction, latestImportBaseline))
    : pendingTransactions;

  const totalEarned = effectiveFrozenTransactions
    .filter(transaction => transaction.transactionType === 'EARN')
    .reduce((sum, transaction) => sum + transaction.hours, 0);

  const totalUsed = effectiveFrozenTransactions
    .filter(transaction => transaction.transactionType === 'USE')
    .reduce((sum, transaction) => sum + transaction.hours, 0);

  const pendingEarn = effectivePendingTransactions
    .filter(transaction => transaction.transactionType === 'EARN')
    .reduce((sum, transaction) => sum + transaction.hours, 0);

  const pendingUse = effectivePendingTransactions
    .filter(transaction => transaction.transactionType === 'USE')
    .reduce((sum, transaction) => sum + transaction.hours, 0);

  return {
    totalEarned,
    totalUsed,
    balance: totalEarned - totalUsed,
    pendingEarn,
    pendingUse,
  };
}

export function planCompLeaveImportRepair(
  transactions: CompLeaveRepairTransaction[]
): CompLeaveImportRepairPlan {
  if (transactions.length === 0) {
    throw new Error('planCompLeaveImportRepair requires at least one transaction');
  }

  const employeeId = transactions[0].employeeId;
  const importBaselines = transactions.filter(isImportBaseline).sort(sortByNewest);
  const latestImportBaseline = importBaselines[0] ?? null;
  const deleteImportIds = importBaselines.slice(1).map(transaction => transaction.id).sort((left, right) => left - right);

  return {
    employeeId,
    latestImportBaselineId: latestImportBaseline?.id ?? null,
    deleteImportIds,
    hasDuplicateImports: deleteImportIds.length > 0,
    recomputedBalance: calculateBalanceSnapshot(transactions, latestImportBaseline),
  };
}