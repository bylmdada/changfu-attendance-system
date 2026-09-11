import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { sendNotification } from '@/lib/realtime-notifications';
import { SCHEDULE_ALL_DEPARTMENTS } from '@/lib/schedule-confirmation-status';
import { getTaiwanDateParts } from '@/lib/timezone';

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && (
    request.headers.get('x-cron-secret') === secret
    || request.headers.get('authorization') === `Bearer ${secret}`
  ));
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授權' }, { status: 401 });
  }

  const now = getTaiwanDateParts(new Date());
  const lastDay = new Date(Date.UTC(now.year, now.month, 0)).getUTCDate();
  if (now.day < lastDay - 2) {
    return NextResponse.json({ success: true, skipped: true, reason: '尚未進入月底前三天' });
  }

  const nextMonthDate = new Date(Date.UTC(now.year, now.month, 1));
  const yearMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const [schedules, releases] = await Promise.all([
    prisma.schedule.findMany({
      where: {
        workDate: { startsWith: `${yearMonth}-` },
        employee: { is: { isActive: true } },
      },
      select: { employee: { select: { department: true } } },
    }),
    prisma.scheduleMonthlyRelease.findMany({
      where: { yearMonth, status: 'PUBLISHED' },
      select: { department: true },
    }),
  ]);

  const scheduledDepartments = [...new Set(
    schedules.map((schedule) => schedule.employee.department).filter((department): department is string => Boolean(department))
  )].sort();
  const hasGlobalRelease = releases.some((release) => (
    release.department === null || release.department === SCHEDULE_ALL_DEPARTMENTS
  ));
  const releasedDepartments = new Set(releases.map((release) => release.department));
  const missingDepartments = hasGlobalRelease
    ? []
    : scheduledDepartments.filter((department) => !releasedDepartments.has(department));

  if (missingDepartments.length === 0) {
    return NextResponse.json({ success: true, yearMonth, missingDepartments });
  }

  const recipients = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['ADMIN', 'HR'] },
      employee: { is: { isActive: true } },
    },
    select: { employeeId: true },
  });

  if (recipients.length > 0) {
    await sendNotification({
      type: 'SCHEDULE_UPDATE',
      priority: 'URGENT',
      channels: ['IN_APP'],
      title: `${yearMonth} 班表尚未完整發布`,
      message: `以下部門已有班表但尚未發布：${missingDepartments.join('、')}`,
      data: { yearMonth, missingDepartments, path: '/schedule-management' },
      targetUsers: recipients.map((recipient) => String(recipient.employeeId)),
      createdBy: 'SYSTEM',
    });
  }

  return NextResponse.json({ success: true, yearMonth, missingDepartments });
}

export const POST = GET;
