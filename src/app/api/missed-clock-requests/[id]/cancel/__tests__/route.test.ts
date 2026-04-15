import { NextRequest } from 'next/server';
import { POST, PUT } from '@/app/api/missed-clock-requests/[id]/cancel/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    missedClockRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    departmentManager: {
      findMany: jest.fn(),
    },
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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('missed clock cancellation authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockPrisma.missedClockRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      cancellationStatus: 'PENDING_MANAGER',
      employee: {
        department: '製造部',
      },
    } as never);
  });

  it('rejects POST when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '我要撤銷' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
  });

  it('rejects manager review when the request employee is outside managed departments', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '人資部' },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('權限');
    expect(mockPrisma.missedClockRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed request ids before loading cancellation records', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/not-a-number/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: 'not-a-number' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請ID格式錯誤');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed request ids before creating cancellation requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/not-a-number/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '我要撤銷' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'not-a-number' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請ID格式錯誤');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before creating cancellation requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的補卡撤銷資料');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before creating cancellation requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/cancel', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"reason":',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before reviewing cancellation requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的補卡撤銷資料');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.missedClockRequest.update).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before reviewing cancellation requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/cancel', {
      method: 'PUT',
      headers: {
        cookie: 'auth-token=session-token',
        'content-type': 'application/json',
      },
      body: '{"opinion":',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.missedClockRequest.update).not.toHaveBeenCalled();
  });
});