import type { Prisma } from '@prisma/client';

export async function clearOvertimeAttendanceLinks(
  tx: Prisma.TransactionClient,
  overtimeRequestId: number
) {
  await tx.attendanceRecord.updateMany({
    where: { clockInOvertimeId: overtimeRequestId },
    data: { clockInOvertimeId: null },
  });
  await tx.attendanceRecord.updateMany({
    where: { clockOutOvertimeId: overtimeRequestId },
    data: { clockOutOvertimeId: null },
  });
}
