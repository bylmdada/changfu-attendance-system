import type { PrismaClient } from '@prisma/client';
import { getTaiwanDayEnd, getTaiwanDayStart } from '@/lib/timezone';

export async function hasClockedAttendance(
  client: Pick<PrismaClient, 'attendanceRecord'>,
  employeeId: number,
  workDate: string
) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(workDate);
  if (!match) throw new Error('調班日期格式錯誤');

  const [, year, month, day] = match.map(Number);
  return Boolean(await client.attendanceRecord.findFirst({
    where: {
      employeeId,
      workDate: {
        gte: getTaiwanDayStart(year, month, day),
        lte: getTaiwanDayEnd(year, month, day),
      },
      OR: [
        { clockInTime: { not: null } },
        { clockOutTime: { not: null } },
      ],
    },
    select: { id: true },
  }));
}
