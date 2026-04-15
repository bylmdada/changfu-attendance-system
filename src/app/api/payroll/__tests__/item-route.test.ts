jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { DELETE, GET, PATCH } from '../[id]/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('payroll item route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
  });

  it('rejects invalid payroll ids on GET before querying prisma', async () => {
    const request = new NextRequest('http://localhost/api/payroll/not-a-number');

    const response = await GET(request, { params: Promise.resolve({ id: 'not-a-number' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的薪資記錄 ID');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects mixed payroll ids on GET instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost/api/payroll/12abc');

    const response = await GET(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的薪資記錄 ID');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('requires csrf validation on PATCH requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ basePay: 30000 })
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF token validation failed');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('does not crash on null PATCH bodies when the payroll record exists', async () => {
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 12,
      employeeId: 5,
      basePay: 32000,
      overtimePay: 1500,
    } as never);
    mockPrisma.payrollRecord.update.mockResolvedValue({
      id: 12,
      employeeId: 5,
      basePay: 32000,
      overtimePay: 1500,
      grossPay: 33500,
      netPay: 33500,
      employee: {
        id: 5,
        employeeId: 'E005',
        name: '測試員工',
        department: 'HR',
        position: 'Specialist',
        baseSalary: 32000,
        hourlyRate: 200,
      },
    } as never);

    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.payrollRecord.findUnique).toHaveBeenCalledWith({ where: { id: 12 } });
    expect(mockPrisma.payrollRecord.update).toHaveBeenCalled();
  });

  it('returns 400 for malformed PATCH JSON before reading payroll records', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.update).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects mixed payroll ids on PATCH before auth-side effects reach prisma', async () => {
    const request = new NextRequest('http://localhost/api/payroll/12abc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ basePay: 30000 })
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的薪資記錄 ID');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.update).not.toHaveBeenCalled();
  });

  it('requires csrf validation on DELETE requests', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost/api/payroll/12', {
      method: 'DELETE'
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '12' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('CSRF token validation failed');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects mixed payroll ids on DELETE instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost/api/payroll/12abc', {
      method: 'DELETE'
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '12abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的薪資記錄 ID');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.delete).not.toHaveBeenCalled();
  });
});