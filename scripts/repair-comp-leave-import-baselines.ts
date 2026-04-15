import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { planCompLeaveImportRepair, type CompLeaveRepairTransaction } from '../src/lib/comp-leave-import-repair';
import { getRepairCompLeaveUsage, parseRepairCompLeaveArgs, validateRepairCompLeaveOptions } from '../src/lib/repair-comp-leave-cli';
import { buildRepairCompLeaveJsonReport } from '../src/lib/repair-comp-leave-report';
import { formatRepairDatabaseError, resolveRepairDatabaseTarget, type RepairDatabaseFileState } from '../src/lib/repair-database-target';

let prisma: PrismaClient | null = null;

function groupByEmployee(transactions: CompLeaveRepairTransaction[]) {
  const grouped = new Map<number, CompLeaveRepairTransaction[]>();

  for (const transaction of transactions) {
    const employeeTransactions = grouped.get(transaction.employeeId) ?? [];
    employeeTransactions.push(transaction);
    grouped.set(transaction.employeeId, employeeTransactions);
  }

  return grouped;
}

function getSqliteFileState(filePath: string | null): RepairDatabaseFileState | undefined {
  if (!filePath) {
    return undefined;
  }

  try {
    const stats = fs.statSync(filePath);
    return {
      exists: true,
      sizeBytes: stats.size,
    };
  } catch {
    return {
      exists: false,
      sizeBytes: null,
    };
  }
}

async function main() {
  const options = parseRepairCompLeaveArgs(process.argv.slice(2));

  if (options.help) {
    console.log(getRepairCompLeaveUsage());
    return;
  }

  validateRepairCompLeaveOptions(options);

  const target = resolveRepairDatabaseTarget(
    options.databaseUrl ?? process.env.DATABASE_URL,
    process.cwd(),
    {
      envDatabaseUrl: process.env.DATABASE_URL,
      preferArgSource: Boolean(options.databaseUrl),
    }
  );
  const fileState = getSqliteFileState(target.resolvedPath);
  const sourceLabel = target.source === 'arg'
    ? '命令列參數'
    : target.source === 'env'
      ? 'DATABASE_URL'
      : 'fallback';
  const targetLabel = target.resolvedPath ?? target.databaseUrl;

  if (!options.json) {
    console.log(options.apply
      ? '開始執行補休 IMPORT 基準資料修復...'
      : '開始補休 IMPORT 基準資料檢查（dry-run，不會寫入資料）...');
  }

  if (target.isSqlite && fileState?.exists === false) {
    throw new Error(formatRepairDatabaseError(new Error('SQLite database file not found'), target, fileState));
  }

  if (target.isSqlite && fileState?.exists && fileState.sizeBytes === 0) {
    throw new Error(formatRepairDatabaseError(new Error('SQLite database file is empty'), target, fileState));
  }

  if (!options.json) {
    console.log(`資料庫目標: ${targetLabel} (${sourceLabel})`);
  }

  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: target.databaseUrl,
      },
    },
  });

  let transactions: CompLeaveRepairTransaction[];

  try {
    transactions = await prisma.compLeaveTransaction.findMany({
      where: options.employeeId ? { employeeId: options.employeeId } : undefined,
      orderBy: [
        { employeeId: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    }) as CompLeaveRepairTransaction[];
  } catch (error) {
    throw new Error(formatRepairDatabaseError(error, target, fileState));
  }

  if (transactions.length === 0) {
    if (options.json) {
      console.log(JSON.stringify(buildRepairCompLeaveJsonReport({
        targetLabel,
        targetSourceLabel: sourceLabel,
        employeeIdFilter: options.employeeId,
        status: 'no-data',
        plans: [],
      }), null, 2));
    } else {
      console.log('找不到任何補休交易資料');
    }
    return;
  }

  const employeeGroups = groupByEmployee(transactions);
  const plans = Array.from(employeeGroups.values())
    .map(group => planCompLeaveImportRepair(group))
    .filter(plan => plan.hasDuplicateImports);

  if (plans.length === 0) {
    if (options.json) {
      console.log(JSON.stringify(buildRepairCompLeaveJsonReport({
        targetLabel,
        targetSourceLabel: sourceLabel,
        employeeIdFilter: options.employeeId,
        status: 'no-duplicates',
        plans: [],
      }), null, 2));
    } else {
      console.log('未發現需要修復的重複 IMPORT 基準');
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(buildRepairCompLeaveJsonReport({
      targetLabel,
      targetSourceLabel: sourceLabel,
      employeeIdFilter: options.employeeId,
      status: 'needs-repair',
      plans,
    }), null, 2));
    return;
  }

  let deleteCount = 0;

  for (const plan of plans) {
    deleteCount += plan.deleteImportIds.length;

    console.log([
      `員工 ${plan.employeeId}:`,
      `保留 IMPORT#${plan.latestImportBaselineId ?? 'none'}`,
      `刪除 ${plan.deleteImportIds.join(', ')}`,
      `重算 balance=${plan.recomputedBalance.balance}`,
      `frozen=${plan.recomputedBalance.totalEarned}-${plan.recomputedBalance.totalUsed}`,
      `pending=${plan.recomputedBalance.pendingEarn}-${plan.recomputedBalance.pendingUse}`,
    ].join(' | '));
  }

  console.log(`共 ${plans.length} 位員工需要修復，將刪除 ${deleteCount} 筆舊 IMPORT 基準`);

  if (!options.apply) {
    console.log('dry-run 完成；若要實際寫入，請加上 --apply');
    return;
  }

  for (const plan of plans) {
    await prisma.$transaction(async tx => {
      await tx.compLeaveTransaction.deleteMany({
        where: {
          employeeId: plan.employeeId,
          id: { in: plan.deleteImportIds },
        },
      });

      await tx.compLeaveBalance.upsert({
        where: { employeeId: plan.employeeId },
        update: plan.recomputedBalance,
        create: {
          employeeId: plan.employeeId,
          ...plan.recomputedBalance,
        },
      });
    });
  }

  console.log('修復完成');
}

main()
  .catch(error => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('補休 IMPORT 基準修復失敗:', error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });