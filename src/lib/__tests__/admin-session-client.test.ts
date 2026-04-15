import {
  buildAuthMeRequest,
  buildCookieSessionRequest,
  buildSalaryManagementListRequest,
  buildLogoutRequest,
} from '@/lib/admin-session-client';

describe('admin session client request builders', () => {
  it('builds auth-me request with cookie credentials only', () => {
    const request = buildAuthMeRequest('http://localhost:3000');

    expect(request.url).toBe('http://localhost:3000/api/auth/me');
    expect(request.options).toEqual({
      credentials: 'include',
    });
    expect(request.options).not.toHaveProperty('headers');
  });

  it('builds salary management list request with cookie credentials only', () => {
    const request = buildSalaryManagementListRequest('http://localhost:3000');

    expect(request.url).toBe('http://localhost:3000/api/salary-management?type=list');
    expect(request.options).toEqual({
      credentials: 'include',
    });
    expect(request.options).not.toHaveProperty('headers');
  });

  it('builds generic cookie-session requests without authorization headers', () => {
    const request = buildCookieSessionRequest('http://localhost:3000', '/api/employees');

    expect(request.url).toBe('http://localhost:3000/api/employees');
    expect(request.options).toEqual({
      credentials: 'include',
    });
    expect(request.options).not.toHaveProperty('headers');
  });

  it('builds logout request without bearer headers so csrf helper can add the token', () => {
    const request = buildLogoutRequest('http://localhost:3000');

    expect(request.url).toBe('http://localhost:3000/api/auth/logout');
    expect(request.options).toEqual({
      method: 'POST',
    });
    expect(request.options).not.toHaveProperty('headers');
  });
});