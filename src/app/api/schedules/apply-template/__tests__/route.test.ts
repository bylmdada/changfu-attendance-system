jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    $transaction: jest.fn(),
    employee: {
      findMany: jest.fn(),
    },
    schedule: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import fs from 'fs';
import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';
import { POST } from '../route';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;

describe('schedule apply-template csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 9,
      employeeId: 31,
      username: 'scheduler',
      role: 'ADMIN',
    } as never);
    mockGetManageableDepartments.mockResolvedValue([] as never);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify([
      {
        id: 1,
        name: '標準模版',
        description: '',
        monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
        sunday: { shiftType: 'rd', startTime: '', endTime: '', breakTime: 0 },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]) as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      { id: 31, employeeId: 'E031', name: '王小明', department: '行政部', position: '專員' },
    ] as never);
    mockPrisma.schedule.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.schedule.createMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === 'function') {
        return callback({
          schedule: {
            deleteMany: mockPrisma.schedule.deleteMany,
            createMany: mockPrisma.schedule.createMany,
          },
        });
      }

      return callback;
    });
  });

  it('rejects POST when csrf validation fails before deleting existing schedules', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/schedules/apply-template', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        templateId: 1,
        year: 2026,
        month: 5,
        employeeIds: [31],
        overwriteExisting: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.createMany).not.toHaveBeenCalled();
  });

  it('rejects malformed template ids before querying employees', async () => {
    const request = new NextRequest('http://localhost/api/schedules/apply-template', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        templateId: '1abc',
        year: 2026,
        month: 5,
        employeeIds: [31],
        overwriteExisting: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('templateId 格式錯誤');
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects malformed employeeIds before deleting schedules', async () => {
    const request = new NextRequest('http://localhost/api/schedules/apply-template', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        templateId: 1,
        year: 2026,
        month: 5,
        employeeIds: ['31abc'],
        overwriteExisting: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeIds 格式錯誤');
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects apply-template when some selected employees no longer exist or are inactive', async () => {
    mockPrisma.employee.findMany.mockResolvedValueOnce([
      { id: 31, employeeId: 'E031', name: '王小明', department: '行政部', position: '專員' },
    ] as never);

    const request = new NextRequest('http://localhost/api/schedules/apply-template', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        templateId: 1,
        year: 2026,
        month: 5,
        employeeIds: [31, 32],
        overwriteExisting: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '部分員工不存在或已停用，請重新整理後再試',
      failedEmployeeIds: [32],
    });
    expect(mockPrisma.schedule.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.createMany).not.toHaveBeenCalled();
  });

  it('returns 400 when template application writes zero schedules after transactional delete', async () => {
    mockPrisma.schedule.createMany.mockResolvedValueOnce({ count: 0 } as never);

    const request = new NextRequest('http://localhost/api/schedules/apply-template', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        templateId: 1,
        year: 2026,
        month: 5,
        employeeIds: [31],
        overwriteExisting: true,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('套用模版失敗，未建立任何班表');
    expect(mockPrisma.schedule.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.schedule.createMany).toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating apply-template payload', async () => {
    const request = new NextRequest('http://localhost/api/schedules/apply-template', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"templateId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.createMany).not.toHaveBeenCalled();
  });
});