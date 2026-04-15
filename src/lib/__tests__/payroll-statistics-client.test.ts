import { buildPayrollStatisticsRequest } from '@/lib/payroll-statistics-client';

describe('payroll statistics client', () => {
  it('builds a cookie-session request without authorization headers', () => {
    const request = buildPayrollStatisticsRequest('http://localhost:3001', {
      year: '2026',
      month: '4',
      department: 'HR'
    });

    expect(request.url).toBe('http://localhost:3001/api/payroll/statistics?year=2026&month=4&department=HR');
    expect(request.options).toEqual({
      credentials: 'include'
    });
  });

  it('omits empty filters from the query string', () => {
    const request = buildPayrollStatisticsRequest('http://localhost:3001', {
      year: '2026',
      month: '',
      department: ''
    });

    expect(request.url).toBe('http://localhost:3001/api/payroll/statistics?year=2026');
  });
});