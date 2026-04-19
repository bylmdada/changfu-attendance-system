import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/test-password-strength/route';

describe('/api/auth/test-password-strength', () => {
  it('rejects null request bodies before destructuring password strength inputs', async () => {
    const request = new NextRequest('http://localhost/api/auth/test-password-strength', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '密碼不能為空' });
  });

  it('rejects malformed password policies before evaluating rule fields', async () => {
    const request = new NextRequest('http://localhost/api/auth/test-password-strength', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        password: 'Abc123!!',
        policy: null
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '密碼政策設定無效' });
  });

  it('rejects malformed JSON request bodies before destructuring password strength inputs', async () => {
    const request = new NextRequest('http://localhost/api/auth/test-password-strength', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"password":'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
  });

  it('fails passwords that meet composition rules but miss the minimum strength score threshold', async () => {
    const request = new NextRequest('http://localhost/api/auth/test-password-strength', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        password: 'Paaaaaaa',
        policy: {
          minLength: 8,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: false,
          requireSpecialChars: false,
          allowedSpecialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
          expirationMonths: 0,
          preventPasswordReuse: false,
          passwordHistoryCount: 5,
          preventSequentialChars: false,
          preventBirthdate: false,
          preventCommonPasswords: false,
          customBlockedPasswords: [],
          enableStrengthMeter: true,
          minimumStrengthScore: 4,
          allowAdminExceptions: true,
          requireExceptionReason: true,
          enablePasswordHints: false,
          lockoutAfterFailedAttempts: true,
          maxFailedAttempts: 5,
          lockoutDurationMinutes: 30,
          enableTwoFactorAuth: false,
          notifyPasswordExpiration: true,
          notificationDaysBefore: 7
        }
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.passesPolicy).toBe(false);
    expect(payload.violations).toContain('密碼強度至少需要達到 4 分');
  });
});
