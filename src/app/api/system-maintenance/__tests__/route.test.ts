jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/system-maintenance', () => ({
  systemMonitor: {
    startMonitoring: jest.fn(),
    stopMonitoring: jest.fn(),
    performHealthCheck: jest.fn(),
    executeMaintenanceTask: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { systemMonitor } from '@/lib/system-maintenance';
import { POST } from '@/app/api/system-maintenance/route';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockSystemMonitor = systemMonitor as jest.Mocked<typeof systemMonitor>;

describe('system maintenance body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      userId: 1,
      employeeId: 1,
    } as never);
  });

  it('rejects malformed POST bodies before invoking maintenance actions', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-maintenance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: '{"action":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockSystemMonitor.startMonitoring).not.toHaveBeenCalled();
    expect(mockSystemMonitor.performHealthCheck).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before invoking maintenance actions', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-maintenance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的系統維護操作資料' });
    expect(mockSystemMonitor.startMonitoring).not.toHaveBeenCalled();
    expect(mockSystemMonitor.performHealthCheck).not.toHaveBeenCalled();
  });
});