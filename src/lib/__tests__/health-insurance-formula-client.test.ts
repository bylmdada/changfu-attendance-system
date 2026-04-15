import {
  buildAuthMeRequest,
  buildHealthInsuranceFormulaRequest,
} from '@/lib/health-insurance-formula-client';

describe('health insurance formula client request builders', () => {
  it('builds auth-me request with cookie credentials only', () => {
    const { url, options } = buildAuthMeRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/auth/me');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });

  it('builds formula request with cookie credentials only', () => {
    const { url, options } = buildHealthInsuranceFormulaRequest('http://localhost:3000');

    expect(url).toBe('http://localhost:3000/api/system-settings/health-insurance-formula');
    expect(options).toEqual({ credentials: 'include' });
    expect(options).not.toHaveProperty('headers');
  });
});