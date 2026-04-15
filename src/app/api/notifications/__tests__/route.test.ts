jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/realtime-notifications', () => ({
  notificationSystem: {
    getStats: jest.fn(),
    markAsRead: jest.fn(),
    addConnection: jest.fn(),
    removeConnection: jest.fn(),
  },
  sendNotification: jest.fn(),
  getNotificationById: jest.fn(),
  getUserNotifications: jest.fn(),
  NotificationTemplates: {},
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/notifications/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import {
  getNotificationById,
  getUserNotifications,
  sendNotification,
} from '@/lib/realtime-notifications';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetNotificationById = getNotificationById as jest.MockedFunction<typeof getNotificationById>;
const mockGetUserNotifications = getUserNotifications as jest.MockedFunction<typeof getUserNotifications>;
const mockSendNotification = sendNotification as jest.MockedFunction<typeof sendNotification>;

describe('/api/notifications route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserNotifications.mockReturnValue([]);
  });

  it('blocks non-admin notification detail access even when userId is spoofed in query', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 11,
      username: 'employee',
      role: 'EMPLOYEE',
    } as never);
    mockGetNotificationById.mockReturnValue({
      id: 'notification-1',
      targetUsers: ['2'],
      title: 'hidden',
    } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/notifications?action=notification-details&id=notification-1&userId=2')
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '權限不足' });
  });

  it('rejects invalid limit query values before reading notifications', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 11,
      username: 'employee',
      role: 'EMPLOYEE',
    } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/notifications?action=user-notifications&limit=abc')
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'limit 參數格式無效' });
    expect(mockGetUserNotifications).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before processing notification actions', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 99,
      employeeId: 22,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('rejects invalid notification channels before dispatching', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 99,
      employeeId: 22,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'send-notification',
        type: 'ANNOUNCEMENT',
        priority: 'NORMAL',
        channels: ['FAX'],
        title: 'test',
        message: 'body',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的通知通道' });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});