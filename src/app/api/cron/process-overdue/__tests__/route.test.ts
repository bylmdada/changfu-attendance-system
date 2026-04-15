import { NextRequest } from 'next/server';

jest.mock('@/lib/approval-scheduler', () => ({
  getOverdueSettings: jest.fn(),
  processOverdueApprovals: jest.fn(),
}));

describe('process-overdue cron auth guards', () => {
  const env = process.env as Record<string, string | undefined>;
  const originalCronSecret = process.env.CRON_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
    delete env.CRON_SECRET;
    env.NODE_ENV = 'production';
  });

  afterAll(() => {
    if (originalCronSecret === undefined) {
      delete env.CRON_SECRET;
    } else {
      env.CRON_SECRET = originalCronSecret;
    }

    if (originalNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = originalNodeEnv;
    }
  });

  it('rejects the legacy fallback secret when CRON_SECRET is not configured', async () => {
    const { GET } = await import('@/app/api/cron/process-overdue/route');

    const response = await GET(new NextRequest('http://localhost:3000/api/cron/process-overdue?secret=changfu-cron-2024'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '未授權', message: '請提供有效的 cron secret' });
  });
});