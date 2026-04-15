jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    inAppNotification: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/in-app-notifications/route';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('/api/in-app-notifications route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE',
    } as never);
  });

  it('rejects invalid limit values before querying notifications', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/in-app-notifications?limit=invalid')
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'limit 參數格式無效' });
    expect(mockPrisma.inAppNotification.findMany).not.toHaveBeenCalled();
  });

  it('falls back to null when stored notification data is invalid JSON', async () => {
    mockPrisma.inAppNotification.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 21,
        type: 'SYSTEM',
        title: 'broken',
        message: 'payload',
        data: '{',
        isRead: false,
        readAt: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    ] as never);
    mockPrisma.inAppNotification.count.mockResolvedValueOnce(1 as never).mockResolvedValueOnce(1 as never);

    const response = await GET(new NextRequest('http://localhost/api/in-app-notifications'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.notifications[0].data).toBeNull();
  });

  it('rejects malformed JSON bodies before mutating notifications', async () => {
    const request = new NextRequest('http://localhost/api/in-app-notifications', {
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
    expect(mockPrisma.inAppNotification.updateMany).not.toHaveBeenCalled();
  });

  it('rejects invalid notificationIds for markAsRead', async () => {
    const request = new NextRequest('http://localhost/api/in-app-notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'markAsRead',
        notificationIds: ['1'],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'notificationIds 參數格式無效' });
    expect(mockPrisma.inAppNotification.updateMany).not.toHaveBeenCalled();
  });

  it('returns 400 when markAsRead does not update any notifications', async () => {
    mockPrisma.inAppNotification.updateMany.mockResolvedValue({ count: 0 } as never);

    const request = new NextRequest('http://localhost/api/in-app-notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'markAsRead',
        notificationIds: [1, 2],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '找不到可標記為已讀的通知' });
  });

  it('returns 400 when markAllAsRead has nothing to update', async () => {
    mockPrisma.inAppNotification.updateMany.mockResolvedValue({ count: 0 } as never);

    const request = new NextRequest('http://localhost/api/in-app-notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'markAllAsRead',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '沒有可標記為已讀的通知' });
  });

  it('returns 400 when delete does not remove any notifications', async () => {
    mockPrisma.inAppNotification.deleteMany.mockResolvedValue({ count: 0 } as never);

    const request = new NextRequest('http://localhost/api/in-app-notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'delete',
        notificationIds: [99],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '找不到可刪除的通知' });
  });

  it('returns 400 when markAsRead does not update any notifications', async () => {
    mockPrisma.inAppNotification.updateMany.mockResolvedValue({ count: 0 } as never);

    const request = new NextRequest('http://localhost/api/in-app-notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'markAsRead',
        notificationIds: [1, 2],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '找不到可標記為已讀的通知' });
  });

  it('returns 400 when markAllAsRead has nothing to update', async () => {
    mockPrisma.inAppNotification.updateMany.mockResolvedValue({ count: 0 } as never);

    const request = new NextRequest('http://localhost/api/in-app-notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'markAllAsRead',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '沒有可標記為已讀的通知' });
  });

  it('returns 400 when delete does not remove any notifications', async () => {
    mockPrisma.inAppNotification.deleteMany.mockResolvedValue({ count: 0 } as never);

    const request = new NextRequest('http://localhost/api/in-app-notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'delete',
        notificationIds: [99],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '找不到可刪除的通知' });
  });
});