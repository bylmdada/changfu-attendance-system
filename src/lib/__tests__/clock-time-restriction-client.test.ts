import {
  buildAuthMeRequest,
  buildClockTimeRestrictionRequest,
} from '@/lib/clock-time-restriction-client';

describe('clock time restriction client request builders', () => {
  it('builds auth-me request with cookie credentials only', () => {
    const { url, options } = buildAuthMeRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/auth/me');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });

  it('builds clock time restriction request with cookie credentials only', () => {
    const { url, options } = buildClockTimeRestrictionRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/system-settings/clock-time-restriction');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });
});