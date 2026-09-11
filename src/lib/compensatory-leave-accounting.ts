import type { Prisma } from '@prisma/client';
import { deriveLeaveHours } from '@/lib/leave-management-helpers';
import { isCompensatoryLeaveType } from '@/lib/leave-types';
import { getTaiwanYearMonth } from '@/lib/timezone';

type CompLeaveAccountingClient = Pick<Prisma.TransactionClient, 'compLeaveBalance' | 'compLeaveTransaction'>;

type LeaveForCompAccounting = {
  id: number;
  employeeId: number;
  leaveType?: string | null;
  startDate?: Date | string | null;
  totalDays?: number | null;
  reason?: string | null;
};

function getLeaveHours(leave: LeaveForCompAccounting) {
  return deriveLeaveHours(Number(leave.totalDays ?? 0));
}

function getAvailableHours(balance: { balance: number; pendingEarn: number; pendingUse: number } | null) {
  return balance ? balance.balance + balance.pendingEarn - balance.pendingUse : 0;
}

export async function applyCompensatoryLeaveUse(
  tx: CompLeaveAccountingClient,
  leave: LeaveForCompAccounting
) {
  if (!isCompensatoryLeaveType(leave.leaveType)) return false;

  const hours = getLeaveHours(leave);
  if (hours <= 0) return false;

  const balance = await tx.compLeaveBalance.findUnique({
    where: { employeeId: leave.employeeId },
  });
  if (getAvailableHours(balance) < hours) {
    throw new Error('補休餘額不足，無法核准補休假');
  }

  await tx.compLeaveTransaction.create({
    data: {
      employeeId: leave.employeeId,
      transactionType: 'USE',
      hours,
      referenceId: leave.id,
      referenceType: 'LEAVE',
      yearMonth: getTaiwanYearMonth(new Date(leave.startDate ?? new Date())),
      description: `補休假核准 - ${leave.reason || `請假申請 #${leave.id}`}`,
      isFrozen: false,
    },
  });

  await tx.compLeaveBalance.update({
    where: { employeeId: leave.employeeId },
    data: {
      pendingUse: { increment: hours },
    },
  });

  return true;
}

export async function reverseCompensatoryLeaveUse(
  tx: CompLeaveAccountingClient,
  leave: LeaveForCompAccounting,
  referenceType: 'LEAVE_CANCEL' | 'LEAVE_VOID'
) {
  if (!isCompensatoryLeaveType(leave.leaveType)) return false;

  const originalUse = await tx.compLeaveTransaction.findFirst({
    where: {
      employeeId: leave.employeeId,
      transactionType: 'USE',
      referenceId: leave.id,
      referenceType: 'LEAVE',
    },
    orderBy: { id: 'desc' },
  });
  if (!originalUse) {
    // ponytail: legacy approved comp leave before L5 fix had no transaction; nothing to reverse.
    return false;
  }
  if (originalUse.isFrozen) {
    throw new Error('補休交易已凍結，無法自動回補');
  }

  await tx.compLeaveTransaction.create({
    data: {
      employeeId: leave.employeeId,
      transactionType: 'EARN',
      hours: originalUse.hours,
      referenceId: leave.id,
      referenceType,
      yearMonth: originalUse.yearMonth,
      description: referenceType === 'LEAVE_CANCEL'
        ? `補休假撤銷回補 - 請假申請 #${leave.id}`
        : `補休假作廢回補 - 請假申請 #${leave.id}`,
      isFrozen: false,
    },
  });

  await tx.compLeaveBalance.upsert({
    where: { employeeId: leave.employeeId },
    update: {
      pendingEarn: { increment: originalUse.hours },
    },
    create: {
      employeeId: leave.employeeId,
      pendingEarn: originalUse.hours,
    },
  });

  return true;
}
