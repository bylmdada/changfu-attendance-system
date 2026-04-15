jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
  hasFullScheduleManagementAccess: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

import fs from 'fs';
import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';
import { getManageableDepartments, hasFullScheduleManagementAccess } from '@/lib/schedule-management-permissions';
import { POST } from '../route';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockHasFullAccess = hasFullScheduleManagementAccess as jest.MockedFunction<typeof hasFullScheduleManagementAccess>;

describe('schedule templates create csrf guard', () => {
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
    mockHasFullAccess.mockReturnValue(true);
    mockPrisma.employee.findUnique.mockResolvedValue({
      name: '王小明',
      department: '行政部',
    } as never);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('[]' as never);
  });

  it('rejects POST when csrf validation fails before loading creator info', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/schedules/templates', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '新模版',
        description: '',
        monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
        sunday: { shiftType: 'rd', startTime: '', endTime: '', breakTime: 0 },
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies on POST before loading creator info', async () => {
    const request = new NextRequest('http://localhost/api/schedules/templates', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"name":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});