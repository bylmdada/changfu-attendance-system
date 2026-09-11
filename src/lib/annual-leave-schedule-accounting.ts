import type { Prisma } from '@prisma/client';
import { getLeaveDurationSchedules } from '@/lib/leave-duration-schedules';
import { calculateLeaveHoursByDate } from '@/lib/leave-management-helpers';
import { getTaiwanTimeParts, toTaiwanDateStr } from '@/lib/timezone';
import { prisma } from '@/lib/database';
import { getAnnualLeaveYearBreakdown, getLegacyAnnualLeaveYearBreakdown } from '@/lib/annual-leave';
import { isAnnualLeaveType } from '@/lib/leave-types';
import { applyCompensatoryLeaveUse } from '@/lib/compensatory-leave-accounting';

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

export async function applyApprovedLeaveAccounting(tx: Prisma.TransactionClient, leave: AccountedLeave) {
  if (isAnnualLeaveType(leave.leaveType)) {
    const hoursByDate = await getAnnualLeaveHoursByDate(
      leave.employeeId, new Date(leave.startDate!), new Date(leave.endDate!), tx
    );
    const years = getAnnualLeaveYearBreakdown(hoursByDate);
    if (!years.length) throw new Error('沒有可扣帳的特休工時');
    for (const { year, days } of years) {
      const result = await tx.annualLeave.updateMany({
        where: { employeeId: leave.employeeId, year, remainingDays: { gte: days } },
        data: { usedDays: { increment: days }, remainingDays: { decrement: days } },
      });
      if (result.count !== 1) throw new Error('特休餘額不足或年度未設定');
    }
    await applyAnnualLeaveHoursToSchedules(tx, leave.employeeId, hoursByDate);
    await tx.leaveRequest.update({
      where: { id: leave.id },
      data: { annualLeaveAccounting: JSON.stringify(hoursByDate) },
    });
  }
  await applyCompensatoryLeaveUse(tx, leave);
}

export async function reverseApprovedAnnualLeaveAccounting(tx: Prisma.TransactionClient, leave: AccountedLeave) {
  if (!isAnnualLeaveType(leave.leaveType) || !leave.startDate || !leave.endDate) return;
  const hoursByDate: Record<string, number> = leave.annualLeaveAccounting
    ? JSON.parse(leave.annualLeaveAccounting)
    : await getAnnualLeaveHoursByDate(leave.employeeId, new Date(leave.startDate), new Date(leave.endDate));
  const years = leave.annualLeaveAccounting
    ? getAnnualLeaveYearBreakdown(hoursByDate)
    : getLegacyAnnualLeaveYearBreakdown(leave.startDate, leave.endDate);
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
