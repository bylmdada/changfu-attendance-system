import {
  buildAuthMeRequest,
  buildEmailNotificationRequest,
  buildSmtpSettingsRequest,
} from '@/lib/email-notification-client';

describe('email notification client request builders', () => {
  it('builds auth-me request with cookie credentials only', () => {
    const { url, options } = buildAuthMeRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/auth/me');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });

  it('builds email notification request with cookie credentials only', () => {
    const { url, options } = buildEmailNotificationRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/system-settings/email-notification');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });

  it('builds smtp request with cookie credentials only', () => {
    const { url, options } = buildSmtpSettingsRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/system-settings/smtp');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });
});