import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/cron/overtime-warning/route';
import { getUserFromRequest } from '@/lib/auth';
import { runOvertimeWarningCheck } from '@/lib/overtime-warning';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/overtime-warning', () => ({
  OVERTIME_THRESHOLDS: {
    WARNING: 40,
    LEGAL_LIMIT: 46,
  },
  runOvertimeWarningCheck: jest.fn(),
  getOvertimeSummaryWithAlerts: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  systemLogger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockRunOvertimeWarningCheck = runOvertimeWarningCheck as jest.MockedFunction<typeof runOvertimeWarningCheck>;

describe('overtime warning auth guards', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  afterAll(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it('requires shared auth for POST when CRON_SECRET is not configured', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/cron/overtime-warning', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ year: 2025, month: 1 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
    expect(mockRunOvertimeWarningCheck).not.toHaveBeenCalled();
  });

  it('rejects malformed POST json instead of silently defaulting to current month', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      userId: 1,
      employeeId: 1,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/cron/overtime-warning', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"year":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockRunOvertimeWarningCheck).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies instead of running a default scan', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      userId: 1,
      employeeId: 1,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/cron/overtime-warning', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的加班警示檢查資料' });
    expect(mockRunOvertimeWarningCheck).not.toHaveBeenCalled();
  });

  it('returns 401 on GET when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost:3000/api/cron/overtime-warning'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
  });
});