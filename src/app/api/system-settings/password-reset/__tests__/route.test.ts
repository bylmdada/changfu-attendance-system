jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/database';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('password reset settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
  });

  it('returns defaults when password reset settings are missing', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      emailResetEnabled: false,
      adminContact: '請聯繫系統管理員',
    });
  });

  it('returns stored password reset settings when configuration exists', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_reset_settings',
      value: JSON.stringify({
        emailResetEnabled: true,
        adminContact: 'hr@example.com',
      }),
    } as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      emailResetEnabled: true,
      adminContact: 'hr@example.com',
    });
  });

  it('falls back to defaults when stored password reset JSON is malformed', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'password_reset_settings',
      value: '{bad-json',
    } as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      emailResetEnabled: false,
      adminContact: '請聯繫系統管理員',
    });
    consoleWarnSpy.mockRestore();
  });
});