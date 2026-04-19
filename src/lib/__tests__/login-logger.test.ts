jest.mock('@/lib/database', () => ({
  prisma: {
    loginLog: {
      create: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { LOGIN_STATUS, logLogin } from '@/lib/login-logger';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('login logger user-agent parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.loginLog.create.mockResolvedValue({ id: 1 } as never);
  });

  it('classifies iPhone Safari entries as iOS instead of macOS', async () => {
    const request = new NextRequest('http://localhost/api/auth/login', {
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      },
    });

    await logLogin(request, 'alice', LOGIN_STATUS.SUCCESS, 1);

    expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: 'alice',
        ipAddress: '203.0.113.9',
        device: '手機',
        browser: 'Safari',
        os: 'iOS',
        status: 'SUCCESS',
      }),
    });
  });

  it('classifies Android Chrome entries as Android instead of Linux', async () => {
    const request = new NextRequest('http://localhost/api/auth/login', {
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
        'x-real-ip': '198.51.100.20',
      },
    });

    await logLogin(request, 'alice', LOGIN_STATUS.FAILED_PASSWORD, 1, '密碼錯誤');

    expect(mockPrisma.loginLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ipAddress: '198.51.100.20',
        device: '手機',
        browser: 'Chrome',
        os: 'Android',
        failReason: '密碼錯誤',
      }),
    });
  });
});
