jest.mock('@/lib/database', () => ({
  prisma: {
    systemNotificationSettings: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('email notification route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
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
  });

  it('reads from systemNotificationSettings on GET so returned settings match actual notification behavior', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      settings: {
        enabled: false,
        notifyLeaveApproval: true,
        notifyOvertimeApproval: true,
        notifyShiftApproval: true,
        notifyAnnualLeaveExpiry: true,
      }
    });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to mapped legacy settings when the new notification row is missing', async () => {
    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue(null as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'email_notification_settings',
      value: JSON.stringify({
        enabled: true,
        notifyLeaveApproval: false,
        notifyOvertimeApproval: true,
        notifyScheduleChange: false,
      })
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      headers: {
        cookie: 'token=shared-session-token'
      }
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      success: true,
      settings: {
        enabled: true,
        notifyLeaveApproval: false,
        notifyOvertimeApproval: true,
        notifyShiftApproval: false,
        notifyAnnualLeaveExpiry: true,
      }
    });
  });

  it('updates systemNotificationSettings while preserving unrelated notification channels', async () => {
    mockPrisma.systemNotificationSettings.update.mockResolvedValue({
      id: 1,
      emailEnabled: true,
      inAppEnabled: true,
      leaveApprovalNotify: false,
      overtimeApprovalNotify: true,
      shiftApprovalNotify: false,
      annualLeaveExpiryNotify: true,
      annualLeaveExpiryDays: 30,
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        enabled: true,
        notifyLeaveApproval: false,
        notifyShiftApproval: false,
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.systemNotificationSettings.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        emailEnabled: true,
        inAppEnabled: true,
        leaveApprovalNotify: false,
        overtimeApprovalNotify: true,
        shiftApprovalNotify: false,
        annualLeaveExpiryNotify: true,
        annualLeaveExpiryDays: 30,
      }
    });
    expect(payload).toEqual({
      success: true,
      message: 'Email 通知設定已更新',
      settings: {
        enabled: true,
        notifyLeaveApproval: false,
        notifyOvertimeApproval: true,
        notifyShiftApproval: false,
        notifyAnnualLeaveExpiry: true,
      }
    });
  });

  it('creates systemNotificationSettings when none exist yet', async () => {
    mockPrisma.systemNotificationSettings.findFirst.mockResolvedValue(null as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.systemNotificationSettings.create.mockResolvedValue({
      id: 2,
      emailEnabled: true,
      inAppEnabled: true,
      leaveApprovalNotify: true,
      overtimeApprovalNotify: false,
      shiftApprovalNotify: true,
      annualLeaveExpiryNotify: false,
      annualLeaveExpiryDays: 30,
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: JSON.stringify({
        enabled: true,
        notifyLeaveApproval: true,
        notifyOvertimeApproval: false,
        notifyShiftApproval: true,
        notifyAnnualLeaveExpiry: false,
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.systemNotificationSettings.create).toHaveBeenCalledWith({
      data: {
        emailEnabled: true,
        inAppEnabled: true,
        leaveApprovalNotify: true,
        overtimeApprovalNotify: false,
        shiftApprovalNotify: true,
        annualLeaveExpiryNotify: false,
        annualLeaveExpiryDays: 30,
      }
    });
    expect(payload.settings).toEqual({
      enabled: true,
      notifyLeaveApproval: true,
      notifyOvertimeApproval: false,
      notifyShiftApproval: true,
      notifyAnnualLeaveExpiry: false,
    });
  });

  it('rejects non-boolean notification toggles before persisting settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: 'yes',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '通知開關欄位必須為布林值' });
    expect(mockPrisma.systemNotificationSettings.update).not.toHaveBeenCalled();
    expect(mockPrisma.systemNotificationSettings.create).not.toHaveBeenCalled();
  });

  it('rejects null request bodies on POST before touching persistence', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemNotificationSettings.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.systemNotificationSettings.update).not.toHaveBeenCalled();
    expect(mockPrisma.systemNotificationSettings.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies on POST before touching persistence', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/email-notification', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token'
      },
      body: '{"enabled":'
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
