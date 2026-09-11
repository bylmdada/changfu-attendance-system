import { prisma } from '@/lib/database';
import type { Prisma } from '@prisma/client';
import type { LeaveDurationScheduleMap } from '@/lib/leave-management-helpers';

export async function getLeaveDurationSchedules(
  employeeId: number,
  startDate: string,
  endDate: string,
  reader: Pick<Prisma.TransactionClient, 'schedule'> = prisma
): Promise<LeaveDurationScheduleMap> {
  const schedules = await reader.schedule.findMany({
    where: {
      employeeId,
      workDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      workDate: true,
      shiftType: true,
      startTime: true,
      endTime: true,
      breakTime: true,
      workHours: true,
    },
  });

  return Object.fromEntries(
    schedules.map((schedule) => [
      schedule.workDate,
      {
        shiftType: schedule.shiftType,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        breakTime: schedule.breakTime,
        workHours: schedule.workHours,
      },
    ])
  );
}
