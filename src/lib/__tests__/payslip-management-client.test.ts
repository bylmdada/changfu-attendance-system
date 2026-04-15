import { buildAuthMeRequest, buildPayslipManagementRequest } from '@/lib/payslip-management-client';

describe('payslip management client requests', () => {
  it('builds auth me request with cookie-based session credentials only', () => {
    const request = buildAuthMeRequest('http://localhost:3000');

    expect(request.url).toBe('http://localhost:3000/api/auth/me');
    expect(request.options).toEqual({
      credentials: 'include'
    });
    expect('headers' in request.options).toBe(false);
  });

  it('builds payslip management request with cookie-based session credentials only', () => {
    const request = buildPayslipManagementRequest('http://localhost:3000');

    expect(request.url).toBe('http://localhost:3000/api/system-settings/payslip-management');
    expect(request.options).toEqual({
      credentials: 'include'
    });
    expect('headers' in request.options).toBe(false);
  });
});