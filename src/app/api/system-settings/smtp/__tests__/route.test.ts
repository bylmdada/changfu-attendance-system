jest.mock('@/lib/database', () => ({
  prisma: {
    smtpSettings: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('smtp settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('returns in-memory defaults instead of creating a row on first GET', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      id: 0,
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: true,
      smtpPassword: '',
    });
    expect(mockPrisma.smtpSettings.create).not.toHaveBeenCalled();
  });

  it('masks existing smtp password on GET', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue({
      id: 7,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUser: 'mailer@example.com',
      smtpPassword: 'secret',
      fromEmail: 'noreply@example.com',
      fromName: '長福考勤系統',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings.smtpPassword).toBe('********');
  });

  it('rejects null bodies on POST before destructuring smtp fields', async () => {
    mockPrisma.smtpSettings.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.smtpSettings.create).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.update).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON POST bodies before reading smtp fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/smtp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"smtpHost":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.smtpSettings.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.create).not.toHaveBeenCalled();
    expect(mockPrisma.smtpSettings.update).not.toHaveBeenCalled();
  });
});
