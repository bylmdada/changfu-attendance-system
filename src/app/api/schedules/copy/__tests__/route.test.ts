import { NextRequest } from 'next/server';
import { POST } from '@/app/api/schedules/copy/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    schedule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('schedule copy authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('returns 401 when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/schedules/copy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sourceType: 'week', sourceDate: '2025-01-01', targetDate: '2025-01-08' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
  });

  it('rejects malformed employeeIds before querying Prisma', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      role: 'ADMIN',
      username: 'admin',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/schedules/copy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sourceType: 'week',
        sourceDate: '2025-01-01',
        targetDate: '2025-01-08',
        employeeIds: ['1abc'],
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeIds 格式錯誤');
  });

  it('rejects malformed JSON bodies before evaluating copy payload', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      role: 'ADMIN',
      username: 'admin',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/schedules/copy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"sourceType":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.create).not.toHaveBeenCalled();
    expect(mockPrisma.schedule.update).not.toHaveBeenCalled();
  });
});