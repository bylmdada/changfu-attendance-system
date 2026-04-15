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

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { GET, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('clock reason prompt route csrf guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.systemSettings.upsert.mockResolvedValue({
      key: 'clock_reason_prompt',
      value: JSON.stringify({ enabled: true }),
    } as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'clock_reason_prompt',
      value: JSON.stringify({ enabled: true }),
    } as never);
  });

  it('rejects non-admin GET requests before reading settings', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 2,
      username: 'employee',
      role: 'EMPLOYEE',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('權限不足');
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('rejects PUT when csrf validation fails', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false } as never);

    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        enabled: true,
        earlyClockInThreshold: 5,
        lateClockOutThreshold: 10,
        excludeHolidays: true,
        excludeApprovedOvertime: true,
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('falls back to default settings when stored JSON is malformed on GET', async () => {
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      key: 'clock_reason_prompt',
      value: '{bad-json'
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.settings.enabled).toBe(false);
    expect(payload.settings.earlyClockInThreshold).toBe(5);
  });

  it('rejects null bodies before merging clock reason prompt settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{bad-json',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects dirty earlyClockInThreshold values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        earlyClockInThreshold: '5abc',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '提早上班閾值需在 1-120 分鐘之間' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects dirty lateClockOutThreshold values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        lateClockOutThreshold: '10xyz',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '延後下班閾值需在 1-120 分鐘之間' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean enabled values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        enabled: 'true',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '啟用狀態必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean holiday exclusion values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        excludeHolidays: 'false',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '是否排除假日必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean approved overtime exclusion values before reading stored settings', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/clock-reason-prompt', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        excludeApprovedOvertime: 'false',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '是否排除核准加班必須為布林值' });
    expect(mockPrisma.systemSettings.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.systemSettings.upsert).not.toHaveBeenCalled();
  });
});