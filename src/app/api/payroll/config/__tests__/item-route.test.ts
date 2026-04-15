jest.mock('@/lib/database', () => ({
  prisma: {
    payrollItemConfig: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { DELETE, GET, PUT } from '../[id]/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('payroll config item route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remainingRequests: 10, resetTime: Date.now() });
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, employeeId: 10, username: 'admin', role: 'ADMIN' } as never);
  });

  it('soft-deletes config by marking it inactive', async () => {
    mockPrisma.payrollItemConfig.findUnique.mockResolvedValue({
      id: 3,
      name: '獎金',
      code: 'BONUS',
      type: 'EARNING',
      category: 'BONUS',
      sortOrder: 1,
      description: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    mockPrisma.payrollItemConfig.update.mockResolvedValue({
      id: 3,
      name: '獎金',
      code: 'BONUS',
      type: 'EARNING',
      category: 'BONUS',
      sortOrder: 1,
      description: null,
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const request = new NextRequest('http://localhost/api/payroll/config/3', {
      method: 'DELETE',
      headers: { 'x-csrf-token': 'test-token' }
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '3' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.payrollItemConfig.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { isActive: false }
    });
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('薪資項目配置已停用');
  });

  it('rejects mixed config ids on GET instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost/api/payroll/config/5abc');

    const response = await GET(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的配置 ID' });
    expect(mockPrisma.payrollItemConfig.findUnique).not.toHaveBeenCalled();
  });

  it('updates config and preserves the success envelope', async () => {
    mockPrisma.payrollItemConfig.findUnique.mockResolvedValueOnce({
      id: 5,
      code: 'MEAL',
      name: '伙食津貼',
      type: 'EARNING',
      category: 'ALLOWANCE',
      sortOrder: 1,
      isActive: true,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    mockPrisma.payrollItemConfig.update.mockResolvedValue({
      id: 5,
      code: 'MEAL',
      name: '伙食津貼',
      type: 'EARNING',
      category: 'ALLOWANCE',
      sortOrder: 2,
      isActive: true,
      description: '每月固定',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const request = new NextRequest('http://localhost/api/payroll/config/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'test-token'
      },
      body: JSON.stringify({
        code: 'MEAL',
        name: '伙食津貼',
        type: 'EARNING',
        category: 'ALLOWANCE',
        sortOrder: 2,
        description: '每月固定'
      })
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.config.sortOrder).toBe(2);
    expect(payload.data.config.description).toBe('每月固定');
  });

  it('returns 400 for malformed PUT JSON before reading the target config', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new NextRequest('http://localhost/api/payroll/config/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'test-token'
      },
      body: '{'
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.payrollItemConfig.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollItemConfig.update).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('rejects mixed config ids on PUT before reading the target config', async () => {
    const request = new NextRequest('http://localhost/api/payroll/config/5abc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'test-token'
      },
      body: JSON.stringify({
        code: 'MEAL',
        name: '伙食津貼',
        type: 'EARNING',
        category: 'ALLOWANCE'
      })
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的配置 ID' });
    expect(mockPrisma.payrollItemConfig.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollItemConfig.update).not.toHaveBeenCalled();
  });

  it('rejects mixed config ids on DELETE instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost/api/payroll/config/5abc', {
      method: 'DELETE',
      headers: { 'x-csrf-token': 'test-token' }
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的配置 ID' });
    expect(mockPrisma.payrollItemConfig.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.payrollItemConfig.update).not.toHaveBeenCalled();
  });
});