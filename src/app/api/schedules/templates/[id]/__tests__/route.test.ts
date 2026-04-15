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
import { PUT } from '../route';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockHasFullAccess = hasFullScheduleManagementAccess as jest.MockedFunction<typeof hasFullScheduleManagementAccess>;

describe('schedule template item route guards', () => {
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
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify([
      {
        id: 3,
        name: '原始模版',
        description: '',
        department: '行政部',
        monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
        saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
        sunday: { shiftType: 'rd', startTime: '', endTime: '', breakTime: 0 },
      },
    ]) as never);
  });

  it('rejects malformed request bodies on PUT before loading templates', async () => {
    const request = new NextRequest('http://localhost/api/schedules/templates/3', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"name":',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '3' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});