jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/push-notifications', () => ({
  savePushSubscription: jest.fn(),
  removePushSubscription: jest.fn(),
  getVapidPublicKey: jest.fn(),
  sendTestPush: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    notificationSettings: {
      findUnique: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { savePushSubscription, removePushSubscription } from '@/lib/push-notifications';
import { POST, DELETE } from '../route';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockSavePushSubscription = savePushSubscription as jest.MockedFunction<typeof savePushSubscription>;
const mockRemovePushSubscription = removePushSubscription as jest.MockedFunction<typeof removePushSubscription>;

describe('push subscription csrf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 21,
      username: 'employee',
      role: 'EMPLOYEE',
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockSavePushSubscription.mockResolvedValue(true);
    mockRemovePushSubscription.mockResolvedValue(true);
  });

  it('rejects POST when csrf validation fails before saving subscription', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/push-subscription', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        subscription: {
          endpoint: 'https://push.example/subscriptions/1',
          keys: { p256dh: 'key-a', auth: 'key-b' },
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockSavePushSubscription).not.toHaveBeenCalled();
  });

  it('rejects DELETE when csrf validation fails before removing subscription', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/push-subscription', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=session-token',
      },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockRemovePushSubscription).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before saving a subscription', async () => {
    const request = new NextRequest('http://localhost/api/push-subscription', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: '{',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockSavePushSubscription).not.toHaveBeenCalled();
  });

  it('rejects invalid subscription payloads before persisting them', async () => {
    const request = new NextRequest('http://localhost/api/push-subscription', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=session-token',
      },
      body: JSON.stringify({
        subscription: {
          endpoint: '',
          keys: { p256dh: 'key-a', auth: 'key-b' },
        },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的訂閱資料' });
    expect(mockSavePushSubscription).not.toHaveBeenCalled();
  });
});