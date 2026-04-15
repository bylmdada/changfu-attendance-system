jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/perfect-attendance', () => ({
  getPerfectAttendanceConfig: jest.fn(),
  savePerfectAttendanceConfig: jest.fn(),
  DEFAULT_PERFECT_ATTENDANCE_CONFIG: {
    enabled: true,
    amount: 2000,
    applicableDepartments: ['日照中心'],
    excludedLeaveTypes: ['MARRIAGE', 'FUNERAL'],
  },
}));

import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import {
  getPerfectAttendanceConfig,
  savePerfectAttendanceConfig,
} from '@/lib/perfect-attendance';
import { POST } from '../route';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetPerfectAttendanceConfig = getPerfectAttendanceConfig as jest.MockedFunction<typeof getPerfectAttendanceConfig>;
const mockSavePerfectAttendanceConfig = savePerfectAttendanceConfig as jest.MockedFunction<typeof savePerfectAttendanceConfig>;

describe('perfect attendance bonus route regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfter: 60 } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetPerfectAttendanceConfig.mockResolvedValue({
      enabled: true,
      amount: 2600,
      applicableDepartments: ['日照中心', '行政'],
      excludedLeaveTypes: ['PUBLIC', 'WORK_INJURY'],
    });
    mockSavePerfectAttendanceConfig.mockResolvedValue(undefined);
  });

  it('preserves existing excluded leave types when omitted from updates', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/perfect-attendance-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: false,
        amount: 3200,
        applicableDepartments: ['日照中心'],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockSavePerfectAttendanceConfig).toHaveBeenCalledWith({
      enabled: false,
      amount: 3200,
      applicableDepartments: ['日照中心'],
      excludedLeaveTypes: ['PUBLIC', 'WORK_INJURY'],
    });
  });

  it('rejects non-string department entries before saving config', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/perfect-attendance-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        amount: 3000,
        applicableDepartments: ['日照中心', 123],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '適用部門必須為非空字串陣列' });
    expect(mockSavePerfectAttendanceConfig).not.toHaveBeenCalled();
  });

  it('rejects non-string excluded leave type entries before saving config', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/perfect-attendance-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        amount: 3000,
        applicableDepartments: ['日照中心'],
        excludedLeaveTypes: ['PUBLIC', 456],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '不計入全勤的假別必須為非空字串陣列' });
    expect(mockSavePerfectAttendanceConfig).not.toHaveBeenCalled();
  });

  it('rejects null bodies before validating perfect attendance config', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/perfect-attendance-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockSavePerfectAttendanceConfig).not.toHaveBeenCalled();
  });

  it('returns 400 when POST body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/perfect-attendance-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"enabled":true,',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockGetPerfectAttendanceConfig).not.toHaveBeenCalled();
    expect(mockSavePerfectAttendanceConfig).not.toHaveBeenCalled();
  });

  it('rejects non-boolean enabled values before reading existing config', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/perfect-attendance-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: 'true',
        amount: 3000,
        applicableDepartments: ['日照中心'],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '啟用狀態必須為布林值' });
    expect(mockGetPerfectAttendanceConfig).not.toHaveBeenCalled();
    expect(mockSavePerfectAttendanceConfig).not.toHaveBeenCalled();
  });

  it('rejects invalid amount values before reading existing config', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/perfect-attendance-bonus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        amount: '3000',
        applicableDepartments: ['日照中心'],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '金額必須為正數' });
    expect(mockGetPerfectAttendanceConfig).not.toHaveBeenCalled();
    expect(mockSavePerfectAttendanceConfig).not.toHaveBeenCalled();
  });
});