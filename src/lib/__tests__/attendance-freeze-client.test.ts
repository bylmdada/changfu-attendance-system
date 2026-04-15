import {
  buildAttendanceFreezeRequest,
  buildAuthMeRequest,
} from '@/lib/attendance-freeze-client';

describe('attendance freeze client request builders', () => {
  it('builds auth-me request with cookie credentials only', () => {
    const { url, options } = buildAuthMeRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/auth/me');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });

  it('builds attendance freeze request with cookie credentials only', () => {
    const { url, options } = buildAttendanceFreezeRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/system-settings/attendance-freeze');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });
});