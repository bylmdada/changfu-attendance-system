jest.mock('@/lib/database', () => ({
  prisma: {
    systemNotificationSettings: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
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
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('system notification settings route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue({
      id: 1,
      emailEnabled: false,
      inAppEnabled: true,
      leaveApprovalNotify: true,
      overtimeApprovalNotify: true,
      shiftApprovalNotify: true,
      annualLeaveExpiryNotify: true,
      annualLeaveExpiryDays: 30,
    } as never);
    mockPrisma.systemNotificationSettings.update.mockResolvedValue({
      id: 1,
      emailEnabled: true,
      inAppEnabled: true,
      leaveApprovalNotify: true,
      overtimeApprovalNotify: true,
      shiftApprovalNotify: true,
      annualLeaveExpiryNotify: true,
      annualLeaveExpiryDays: 30,
    } as never);
  });

  it('rejects non-boolean notification toggles before persisting settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/notification-settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        emailEnabled: 'yes',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '通知開關欄位必須為布林值' });
    expect(mockPrisma.systemNotificationSettings.update).not.toHaveBeenCalled();
  });

  it('rejects invalid annual leave expiry days before persisting settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/notification-settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        annualLeaveExpiryDays: -5,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '年假到期提醒天數必須為 0 到 365 的整數' });
    expect(mockPrisma.systemNotificationSettings.update).not.toHaveBeenCalled();
  });

  it('rejects null bodies before validating notification settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/notification-settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemNotificationSettings.update).not.toHaveBeenCalled();
    expect(mockPrisma.systemNotificationSettings.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before validating notification settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/notification-settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"emailEnabled": true',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.systemNotificationSettings.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.systemNotificationSettings.update).not.toHaveBeenCalled();
    expect(mockPrisma.systemNotificationSettings.create).not.toHaveBeenCalled();
  });
});