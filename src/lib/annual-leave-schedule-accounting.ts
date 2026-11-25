import type { Prisma } from '@prisma/client';
import { getLeaveDurationSchedules } from '@/lib/leave-duration-schedules';
import { calculateLeaveHoursByDate } from '@/lib/leave-management-helpers';
import { getTaiwanTimeParts, toTaiwanDateStr } from '@/lib/timezone';
import { prisma } from '@/lib/database';
import { getAnnualLeaveYearBreakdown, getLegacyAnnualLeaveYearBreakdown } from '@/lib/annual-leave';
import { isAnnualLeaveType } from '@/lib/leave-types';
import { applyCompensatoryLeaveUse } from '@/lib/compensatory-leave-accounting';
import { getUsableCarryOverDays, readAnnualLeaveCarryOverPolicy } from '@/lib/annual-leave-carry-over';

export async function getAnnualLeaveHoursByDate(
  employeeId: number,
  startDate: Date,
  endDate: Date,
  reader: Pick<Prisma.TransactionClient, 'schedule'> = prisma
) {
  const startDateText = toTaiwanDateStr(startDate);
  const endDateText = toTaiwanDateStr(endDate);
  const startTime = getTaiwanTimeParts(startDate);
  const endTime = getTaiwanTimeParts(endDate);
  const schedules = await getLeaveDurationSchedules(employeeId, startDateText, endDateText, reader);

  return calculateLeaveHoursByDate({
    startDate: startDateText,
    endDate: endDateText,
    startHour: String(startTime.hour),
    startMinute: String(startTime.minute),
    endHour: String(endTime.hour),
    endMinute: String(endTime.minute),
  }, schedules) ?? {};
}

type AccountedLeave = {
  id: number;
  employeeId: number;
  leaveType?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  totalDays?: number | null;
  reason?: string | null;
  annualLeaveAccounting?: string | null;
};

type AnnualLeaveDeduction = { year: number; days: number };

/**
 * 核准特休時，把各年度的天數從對應年度的額度扣掉；當年度額度不夠、而系統允許遞延且去年度剩餘還沒到期時，
 * 不足的部分改扣去年度。回傳實際扣了哪些年度，撤銷時才能還回原來的年度。
 */
async function deductAnnualLeaveDays(
  tx: Prisma.TransactionClient,
  employeeId: number,
  years: AnnualLeaveDeduction[],
  leaveStartDate: Date
): Promise<AnnualLeaveDeduction[]> {
  const deductions = new Map<number, number>();
  const add = (year: number, days: number) => deductions.set(year, (deductions.get(year) ?? 0) + days);

  for (const { year, days } of years) {
    const result = await tx.annualLeave.updateMany({
      where: { employeeId, year, remainingDays: { gte: days } },
      data: { usedDays: { increment: days }, remainingDays: { decrement: days } },
    });
    if (result.count === 1) {
      add(year, days);
      continue;
    }

    const policy = await readAnnualLeaveCarryOverPolicy(tx);
    if (!policy.enabled) throw new Error('特休餘額不足或年度未設定');

    const own = await tx.annualLeave.findUnique({
      where: { employeeId_year: { employeeId, year } },
      select: { remainingDays: true },
    });
    const fromOwn = Math.max(0, own?.remainingDays ?? 0);
    const shortfall = Math.round((days - fromOwn) * 10000) / 10000;
    const lastYear = await tx.annualLeave.findUnique({
      where: { employeeId_year: { employeeId, year: year - 1 } },
      select: { remainingDays: true, expiryDate: true },
    });
    if (getUsableCarryOverDays(lastYear, policy, leaveStartDate) + 1e-9 < shortfall) {
      throw new Error('特休餘額不足或年度未設定');
    }

    if (fromOwn > 0) {
      const ownResult = await tx.annualLeave.updateMany({
        where: { employeeId, year, remainingDays: { gte: fromOwn } },
        data: { usedDays: { increment: fromOwn }, remainingDays: { decrement: fromOwn } },
      });
      if (ownResult.count !== 1) throw new Error('特休餘額不足或年度未設定');
      add(year, fromOwn);
    }
    const carryResult = await tx.annualLeave.updateMany({
      where: { employeeId, year: year - 1, remainingDays: { gte: shortfall } },
      data: { usedDays: { increment: shortfall }, remainingDays: { decrement: shortfall } },
    });
    if (carryResult.count !== 1) throw new Error('特休餘額不足或年度未設定');
    add(year - 1, shortfall);
  }

  return [...deductions].map(([year, days]) => ({ year, days }));
}

/**
 * 扣帳快照：沒有用到去年度時維持原本的格式（日期→工時），舊版程式也能撤銷；
 * 有扣到去年度才改用 { hoursByDate, deductions }，撤銷時依實際扣的年度還回去。
 */
function serializeAnnualLeaveAccounting(
  hoursByDate: Record<string, number>,
  years: AnnualLeaveDeduction[],
  deductions: AnnualLeaveDeduction[]
) {
  const sameAsLeaveYears = deductions.length === years.length
    && deductions.every((deduction) => years.some((leaveYear) =>
      leaveYear.year === deduction.year && Math.abs(leaveYear.days - deduction.days) < 1e-9));

  return JSON.stringify(sameAsLeaveYears ? hoursByDate : { hoursByDate, deductions });
}

function parseAnnualLeaveAccounting(raw: string): { hoursByDate: Record<string, number>; deductions: AnnualLeaveDeduction[] | null } {
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && parsed.hoursByDate && typeof parsed.hoursByDate === 'object') {
    return { hoursByDate: parsed.hoursByDate, deductions: Array.isArray(parsed.deductions) ? parsed.deductions : null };
  }
  return { hoursByDate: parsed, deductions: null };
}

export async function applyApprovedLeaveAccounting(tx: Prisma.TransactionClient, leave: AccountedLeave) {
  if (isAnnualLeaveType(leave.leaveType)) {
    const hoursByDate = await getAnnualLeaveHoursByDate(
      leave.employeeId, new Date(leave.startDate!), new Date(leave.endDate!), tx
    );
    const years = getAnnualLeaveYearBreakdown(hoursByDate);
    if (!years.length) throw new Error('沒有可扣帳的特休工時');
    const deductions = await deductAnnualLeaveDays(tx, leave.employeeId, years, new Date(leave.startDate!));
    await applyAnnualLeaveHoursToSchedules(tx, leave.employeeId, hoursByDate);
    await tx.leaveRequest.update({
      where: { id: leave.id },
      data: { annualLeaveAccounting: serializeAnnualLeaveAccounting(hoursByDate, years, deductions) },
    });
  }
  await applyCompensatoryLeaveUse(tx, leave);
}

export async function reverseApprovedAnnualLeaveAccounting(tx: Prisma.TransactionClient, leave: AccountedLeave) {
  if (!isAnnualLeaveType(leave.leaveType) || !leave.startDate || !leave.endDate) return;
  const snapshot = leave.annualLeaveAccounting ? parseAnnualLeaveAccounting(leave.annualLeaveAccounting) : null;
  const hoursByDate: Record<string, number> = snapshot
    ? snapshot.hoursByDate
    : await getAnnualLeaveHoursByDate(leave.employeeId, new Date(leave.startDate), new Date(leave.endDate));
  // 有記錄實際扣的年度（含去年度）就照那個還；舊紀錄沒有就依請假日期所在年度還
  const years = snapshot?.deductions
    ?? (snapshot ? getAnnualLeaveYearBreakdown(hoursByDate) : getLegacyAnnualLeaveYearBreakdown(leave.startDate, leave.endDate));
  for (const { year, days } of years) {
    await tx.annualLeave.updateMany({
      where: { employeeId: leave.employeeId, year },
      data: { usedDays: { decrement: days }, remainingDays: { increment: days } },
    });
  }
  await reverseAnnualLeaveHoursFromSchedules(tx, leave.employeeId, hoursByDate);
}

export async function applyAnnualLeaveHoursToSchedules(
  tx: Prisma.TransactionClient,
  employeeId: number,
  hoursByDate: Record<string, number>
) {
  for (const [workDate, hours] of Object.entries(hoursByDate)) {
    await tx.schedule.updateMany({
      where: { employeeId, workDate },
      data: { specialLeaveHours: { increment: hours } },
    });
  }
}

export async function reverseAnnualLeaveHoursFromSchedules(
  tx: Prisma.TransactionClient,
  employeeId: number,
  hoursByDate: Record<string, number>
) {
  for (const [workDate, hours] of Object.entries(hoursByDate)) {
    const schedule = await tx.schedule.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
      select: { specialLeaveHours: true },
    });

    // ponytail: legacy approved leave had no schedule entry, so there is nothing safe to reverse.
    if (!schedule || schedule.specialLeaveHours < hours) continue;

    await tx.schedule.update({
      where: { employeeId_workDate: { employeeId, workDate } },
      data: { specialLeaveHours: { decrement: hours } },
    });
  }
}
