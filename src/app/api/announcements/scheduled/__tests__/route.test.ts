import { NextRequest } from 'next/server';
import { POST } from '@/app/api/announcements/scheduled/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { sendNotification } from '@/lib/realtime-notifications';

jest.mock('@/lib/database', () => ({
  prisma: {
    announcement: {
      findMany: jest.fn(),
    },
    $executeRaw: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/realtime-notifications', () => ({
  sendNotification: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedSendNotification = sendNotification as jest.MockedFunction<typeof sendNotification>;

describe('announcements scheduled csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'hr-user',
      role: 'HR',
      sessionId: 'session-1',
    } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedPrisma.announcement.findMany.mockResolvedValue([] as never);
    mockedPrisma.$executeRaw.mockResolvedValue(0 as never);
  });

  it('rejects POST when csrf validation fails before publishing scheduled announcements', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const response = await POST(new NextRequest('http://localhost/api/announcements/scheduled', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=session-token',
      },
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockedPrisma.$executeRaw).not.toHaveBeenCalled();
    expect(mockedSendNotification).not.toHaveBeenCalled();
  });
});