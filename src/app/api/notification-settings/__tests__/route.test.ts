jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    notificationSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn()
    }
  }
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/notification-settings/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('/api/notification-settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('returns default settings for an authenticated employee without stored preferences', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);
    mockPrisma.notificationSettings.findUnique.mockResolvedValue(null as never);

    const response = await GET(new NextRequest('http://localhost/api/notification-settings'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      settings: {
        employeeId: 21,
        leaveExpiry: true,
        leaveApproval: true,
        overtimeApproval: true,
        shiftExchangeApproval: true,
        systemAnnouncements: true
      }
    });
  });

  it('rejects unauthenticated update requests before writing settings', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/notification-settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ leaveExpiry: false })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '未授權訪問' });
    expect(mockPrisma.notificationSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads before updating settings', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);

    const request = new NextRequest('http://localhost/api/notification-settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockPrisma.notificationSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean notification setting values before writing', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE'
    } as never);

    const request = new NextRequest('http://localhost/api/notification-settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ leaveExpiry: 'false' })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'leaveExpiry 參數格式無效' });
    expect(mockPrisma.notificationSettings.upsert).not.toHaveBeenCalled();
  });
});