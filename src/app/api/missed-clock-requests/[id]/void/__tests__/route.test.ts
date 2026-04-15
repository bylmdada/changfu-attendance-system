import { NextRequest } from 'next/server';
import { POST } from '@/app/api/missed-clock-requests/[id]/void/route';
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

describe('missed clock void authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/void', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'admin void' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed request ids before loading missed clock records', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 10,
      userId: 1,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/bad-id/void', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'admin void' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'bad-id' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請ID格式錯誤');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before loading missed clock records', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 10,
      userId: 1,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/void', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的補卡作廢資料');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed request bodies before loading missed clock records', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 10,
      userId: 1,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests/5/void', {
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
});