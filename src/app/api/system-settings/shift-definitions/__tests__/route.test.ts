jest.mock('@/lib/database', () => ({
  prisma: {
    shiftDefinition: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { DELETE, POST } from '../route';

const mockPrisma = prisma as unknown as {
  shiftDefinition: {
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('shift definitions system settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockPrisma.shiftDefinition.count.mockResolvedValue(9);
    mockPrisma.shiftDefinition.findMany.mockResolvedValue([]);
  });

  it('creates a time-based shift definition', async () => {
    mockPrisma.shiftDefinition.create.mockResolvedValue({
      id: 10,
      code: 'D',
      name: '晚班',
      startTime: '13:00',
      endTime: '22:00',
      breakTime: 60,
      workHours: 8,
      specialLeaveHours: 0,
      compLeaveHours: 0,
      overtimeHours: 0,
      requiresTime: true,
      isActive: true,
      sortOrder: 160,
      description: '晚間服務班',
    });

    const request = new NextRequest('http://localhost/api/system-settings/shift-definitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'D',
        name: '晚班',
        startTime: '13:00',
        endTime: '22:00',
        breakTime: 60,
        requiresTime: true,
        sortOrder: 160,
        description: '晚間服務班',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.shift.label).toBe('晚班 (13:00-22:00｜工時 8小時)');
    expect(mockPrisma.shiftDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'D',
        name: '晚班',
        startTime: '13:00',
        endTime: '22:00',
        breakTime: 60,
        requiresTime: true,
      }),
    });
  });

  it('normalizes a no-time shift definition before saving', async () => {
    mockPrisma.shiftDefinition.create.mockResolvedValue({
      id: 11,
      code: 'TRN',
      name: '教育訓練',
      startTime: '',
      endTime: '',
      breakTime: 0,
      workHours: 0,
      specialLeaveHours: 4,
      compLeaveHours: 0,
      overtimeHours: 0,
      requiresTime: false,
      isActive: true,
      sortOrder: 170,
      description: null,
    });

    const request = new NextRequest('http://localhost/api/system-settings/shift-definitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'TRN',
        name: '教育訓練',
        startTime: '09:00',
        endTime: '18:00',
        breakTime: 60,
        specialLeaveHours: 4,
        requiresTime: false,
        sortOrder: 170,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockPrisma.shiftDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'TRN',
        startTime: '',
        endTime: '',
        breakTime: 0,
        specialLeaveHours: 4,
        requiresTime: false,
      }),
    });
  });

  it('rejects duplicate shift codes case-insensitively', async () => {
    mockPrisma.shiftDefinition.findMany.mockResolvedValue([{ code: 'D' }]);

    const request = new NextRequest('http://localhost/api/system-settings/shift-definitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'd',
        name: '重複班別',
        startTime: '13:00',
        endTime: '22:00',
        breakTime: 60,
        requiresTime: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('班別代碼已存在');
    expect(mockPrisma.shiftDefinition.create).not.toHaveBeenCalled();
  });

  it('soft-deletes shift definitions by marking them inactive', async () => {
    mockPrisma.shiftDefinition.findUnique.mockResolvedValue({
      id: 10,
      code: 'D',
    });
    mockPrisma.shiftDefinition.update.mockResolvedValue({
      id: 10,
      code: 'D',
      name: '晚班',
      startTime: '13:00',
      endTime: '22:00',
      breakTime: 60,
      workHours: 8,
      specialLeaveHours: 0,
      compLeaveHours: 0,
      overtimeHours: 0,
      requiresTime: true,
      isActive: false,
      sortOrder: 160,
      description: null,
    });

    const request = new NextRequest('http://localhost/api/system-settings/shift-definitions?id=10', {
      method: 'DELETE',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.shift.isActive).toBe(false);
    expect(mockPrisma.shiftDefinition.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { isActive: false },
    });
  });
});
