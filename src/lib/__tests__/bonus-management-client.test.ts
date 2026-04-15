import {
  buildAuthMeRequest,
  buildBonusManagementRequest,
} from '@/lib/bonus-management-client';

describe('bonus management client request builders', () => {
  it('builds auth-me request with cookie credentials only', () => {
    const { url, options } = buildAuthMeRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/auth/me');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });

  it('builds bonus management request with cookie credentials only', () => {
    const { url, options } = buildBonusManagementRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/system-settings/bonus-management');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });
});