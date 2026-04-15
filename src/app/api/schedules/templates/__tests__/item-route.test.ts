jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
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
import { getManageableDepartments, hasFullScheduleManagementAccess } from '@/lib/schedule-management-permissions';
import { DELETE, PUT } from '../[id]/route';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockHasFullAccess = hasFullScheduleManagementAccess as jest.MockedFunction<typeof hasFullScheduleManagementAccess>;

const templateJson = JSON.stringify([
  {
    id: 5,
    name: '行政部模板',
    description: '',
    department: '行政部',
    createdById: 31,
    createdByName: '王小明',
    monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
    sunday: { shiftType: 'rd', startTime: '', endTime: '', breakTime: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]);

describe('schedule template item csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 9,
      employeeId: 31,
      username: 'scheduler',
      role: 'ADMIN',
    } as never);
    mockGetManageableDepartments.mockResolvedValue(['行政部'] as never);
    mockHasFullAccess.mockReturnValue(true);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(templateJson as never);
  });

  it('rejects PUT when csrf validation fails before persisting template changes', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/schedules/templates/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(JSON.parse(templateJson)[0]),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects DELETE when csrf validation fails before deleting the template', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost/api/schedules/templates/5', {
      method: 'DELETE',
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects malformed ids before mutating template data', async () => {
    const request = new NextRequest('http://localhost/api/schedules/templates/5abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的模版ID');
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on PUT before mutating template data', async () => {
    const request = new NextRequest('http://localhost/api/schedules/templates/5abc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(JSON.parse(templateJson)[0]),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的模版ID');
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});