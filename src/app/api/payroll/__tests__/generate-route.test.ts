jest.mock('@/lib/database', () => ({
  prisma: {
    holiday: {
      findMany: jest.fn()
    },
    employee: {
      findMany: jest.fn()
    },
    payrollRecord: {
      findFirst: jest.fn()
    },
    attendanceRecord: {
      findMany: jest.fn()
    },
    bonusConfiguration: {
      findMany: jest.fn()
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
import { POST } from '../generate/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('payroll generate route body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
  });

  it('rejects null request bodies before destructuring payroll generation payload', async () => {
    const request = new NextRequest('http://localhost/api/payroll/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('年份和月份為必填');
    expect(mockPrisma.holiday.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed generation JSON before any payroll work starts', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/api/payroll/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.holiday.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});