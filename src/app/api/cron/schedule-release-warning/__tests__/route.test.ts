jest.mock('@/lib/database', () => ({
  prisma: {
    schedule: { findMany: jest.fn() },
    scheduleMonthlyRelease: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}));

jest.mock('@/lib/realtime-notifications', () => ({
  sendNotification: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { sendNotification } from '@/lib/realtime-notifications';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockSendNotification = sendNotification as jest.MockedFunction<typeof sendNotification>;

describe('schedule release warning cron', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T01:00:00.000Z'));
    process.env.CRON_SECRET = 'cron-secret';
    mockPrisma.schedule.findMany.mockResolvedValue([
      { employee: { department: '行政部' } },
      { employee: { department: '護理部' } },
    ] as never);
    mockPrisma.scheduleMonthlyRelease.findMany.mockResolvedValue([
      { department: '護理部' },
    ] as never);
    mockPrisma.user.findMany.mockResolvedValue([
      { employeeId: 1 },
      { employeeId: 2 },
    ] as never);
    mockSendNotification.mockResolvedValue('notification-1');
  });

  afterEach(() => jest.useRealTimers());
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it('rejects calls without the configured cron secret', async () => {
    const response = await GET(new NextRequest('http://localhost/api/cron/schedule-release-warning'));
    expect(response.status).toBe(401);
  });

  it('warns administrators about scheduled departments missing next-month releases', async () => {
    const response = await GET(new NextRequest('http://localhost/api/cron/schedule-release-warning', {
      headers: { 'x-cron-secret': 'cron-secret' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      yearMonth: '2026-08',
      missingDepartments: ['行政部'],
    }));
    expect(mockSendNotification).toHaveBeenCalledWith(expect.objectContaining({
      channels: ['IN_APP'],
      targetUsers: ['1', '2'],
      data: expect.objectContaining({ path: '/schedule-management' }),
    }));
  });
});
