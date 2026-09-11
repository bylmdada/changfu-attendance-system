jest.mock('@/lib/database', () => ({
  prisma: {
    systemSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/system-settings-audit', () => ({
  logSystemSettingsChange: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('overtime calculation route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
  });

  it('rejects non-admin GET requests before loading overtime settings', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 12,
      username: 'employee',
      role: 'EMPLOYEE',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-calculation', {
      headers: {
        cookie: 'token=employee-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.message).toBe('需要管理員權限');
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to defaults when stored overtime settings JSON is malformed', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'overtime_calculation_settings',
      value: '{broken-json',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-calculation');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      weekdayFirstTwoHoursRate: 1.34,
      restDayFirstTwoHoursRate: 4 / 3,
      restDayHours3To8Rate: 5 / 3,
      restDayAfterEightHoursRate: 8 / 3,
      holidayRate: 2,
      overtimeMinUnit: 30,
      compensationMode: 'COMP_LEAVE_ONLY',
    });
  });

  it('only updates overtime settings that are wired to calculation flows', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'overtime_calculation_settings',
      value: JSON.stringify({
        weekdayFirstTwoHoursRate: 1.5,
        weekdayAfterTwoHoursRate: 1.9,
        restDayFirstEightHoursRate: 1.4,
        restDayFirstTwoHoursRate: 9,
        restDayHours3To8Rate: 9,
        restDayAfterEightHoursRate: 1.8,
        holidayRate: 2.2,
        mandatoryRestRate: 2.1,
        weekdayMaxHours: 5,
        restDayMaxHours: 10,
        holidayMaxHours: 7,
        mandatoryRestMaxHours: 7,
        monthlyBasicHours: 230,
        restDayMinimumPayHours: 3,
        overtimeMinUnit: 15,
        compensationMode: 'EMPLOYEE_CHOICE',
        settleOnResignation: false,
        isEnabled: true,
        description: 'custom overtime',
      }),
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-calculation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        weekdayFirstTwoHoursRate: 2.5,
        holidayRate: 2.5,
        isEnabled: false,
        monthlyBasicHours: 0,
        overtimeMinUnit: 60,
        compensationMode: 'OVERTIME_PAY_ONLY',
        description: 'updated',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.settings).toMatchObject({
      weekdayFirstTwoHoursRate: 1.5,
      weekdayAfterTwoHoursRate: 1.9,
      restDayFirstTwoHoursRate: 4 / 3,
      restDayHours3To8Rate: 5 / 3,
      restDayAfterEightHoursRate: 8 / 3,
      holidayRate: 2.2,
      monthlyBasicHours: 230,
      overtimeMinUnit: 60,
      compensationMode: 'OVERTIME_PAY_ONLY',
      settleOnResignation: false,
      isEnabled: true,
      description: 'updated',
    });
    expect(payload.settings).not.toHaveProperty('restDayFirstEightHoursRate');
  });

  it.each([
    ['字串', '60'],
    ['非白名單數值', 7],
    ['小數', 60.5],
  ])('rejects an invalid minimum application unit: %s', async (_name, overtimeMinUnit) => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-calculation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ overtimeMinUnit }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      message: '最低申請時數必須為 1、5、15、30 或 60 分鐘',
    });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects null bodies before validating overtime settings fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-calculation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      message: '請提供有效的設定資料',
    });
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before validating overtime settings fields', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/overtime-calculation', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"holidayRate": 2.5',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      message: '無效的 JSON 格式',
    });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});
