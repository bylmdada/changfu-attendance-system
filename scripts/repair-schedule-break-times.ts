import fs from 'fs';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  getRepairScheduleBreakTimeUsage,
  parseRepairScheduleBreakTimeArgs,
  validateRepairScheduleBreakTimeOptions,
} from '../src/lib/repair-schedule-break-time-cli';
import { formatRepairDatabaseError, resolveRepairDatabaseTarget, type RepairDatabaseFileState } from '../src/lib/repair-database-target';

let prisma: PrismaClient | null = null;

type CandidateSchedule = {
  id: number;
  employeeId: number;
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime: number;
};

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

function buildWhereClause(options: ReturnType<typeof parseRepairScheduleBreakTimeArgs>): Prisma.ScheduleWhereInput {
  const where: Prisma.ScheduleWhereInput = {
    breakTime: 0,
    shiftType: {
      in: options.shiftTypes,
    },
  };

  if (options.employeeId !== null) {
    where.employeeId = options.employeeId;
  }

  if (options.month) {
    where.workDate = {
      startsWith: `${options.month}-`,
    };
  }

  return where;
}

function summarizeSchedules(schedules: CandidateSchedule[]) {
  const shiftTypeCounts = new Map<string, number>();
  const employeeIds = new Set<number>();

  for (const schedule of schedules) {
    shiftTypeCounts.set(schedule.shiftType, (shiftTypeCounts.get(schedule.shiftType) ?? 0) + 1);
    employeeIds.add(schedule.employeeId);
  }

  return {
    totalSchedules: schedules.length,
    employeeCount: employeeIds.size,
    shiftTypeCounts: Object.fromEntries([...shiftTypeCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    sample: schedules.slice(0, 20),
  };
}

async function main() {
  const options = parseRepairScheduleBreakTimeArgs(process.argv.slice(2));

  if (options.help) {
    console.log(getRepairScheduleBreakTimeUsage());
    return;
  }

  validateRepairScheduleBreakTimeOptions(options);

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

  if (target.isSqlite && fileState?.exists === false) {
    throw new Error(formatRepairDatabaseError(new Error('SQLite database file not found'), target, fileState));
  }

  if (target.isSqlite && fileState?.exists && fileState.sizeBytes === 0) {
    throw new Error(formatRepairDatabaseError(new Error('SQLite database file is empty'), target, fileState));
  }

  if (!options.json) {
    console.log(options.apply
      ? '開始執行班表休息時間修復...'
      : '開始班表休息時間檢查（dry-run，不會寫入資料）...');
    console.log(`資料庫目標: ${targetLabel} (${sourceLabel})`);
    console.log(`修復班別: ${options.shiftTypes.join(', ')} | 寫入分鐘數: ${options.minutes ?? '未指定（dry-run）'}`);
    if (options.month) {
      console.log(`限定月份: ${options.month}`);
    }
    if (options.employeeId !== null) {
      console.log(`限定員工 ID: ${options.employeeId}`);
    }
  }

  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: target.databaseUrl,
      },
    },
  });

  const where = buildWhereClause(options);

  let schedules: CandidateSchedule[];

  try {
    schedules = await prisma.schedule.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        workDate: true,
        shiftType: true,
        startTime: true,
        endTime: true,
        breakTime: true,
      },
      orderBy: [
        { workDate: 'asc' },
        { employeeId: 'asc' },
        { id: 'asc' },
      ],
    });
  } catch (error) {
    throw new Error(formatRepairDatabaseError(error, target, fileState));
  }

  const summary = summarizeSchedules(schedules);

  if (schedules.length === 0) {
    const report = {
      target: {
        path: targetLabel,
        source: sourceLabel,
      },
      filters: {
        employeeId: options.employeeId,
        month: options.month ?? null,
        shiftTypes: options.shiftTypes,
        minutes: options.minutes,
      },
      status: 'no-data',
      summary,
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('找不到需要修復的班表資料');
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      target: {
        path: targetLabel,
        source: sourceLabel,
      },
      filters: {
        employeeId: options.employeeId,
        month: options.month ?? null,
        shiftTypes: options.shiftTypes,
        minutes: options.minutes,
      },
      status: 'needs-repair',
      summary,
    }, null, 2));
    return;
  }

  console.log(`需要修復 ${summary.totalSchedules} 筆班表，涉及 ${summary.employeeCount} 位員工`);
  console.log(`班別分布: ${Object.entries(summary.shiftTypeCounts).map(([shiftType, count]) => `${shiftType}=${count}`).join(', ')}`);

  if (!options.apply) {
    console.log('dry-run 完成；若要實際寫入，請加上 --apply');
    return;
  }

  if (options.minutes === null) {
    throw new Error('apply 模式缺少 minutes，請重新檢查 CLI 驗證流程');
  }

  const updateResult = await prisma.schedule.updateMany({
    where,
    data: {
      breakTime: options.minutes,
    },
  });

  console.log(`修復完成，共更新 ${updateResult.count} 筆班表資料`);
}

main()
  .catch(error => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('班表休息時間修復失敗:', error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });