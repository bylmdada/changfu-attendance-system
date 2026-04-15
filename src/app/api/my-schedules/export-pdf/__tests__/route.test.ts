jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '@/app/api/my-schedules/export-pdf/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

describe('my-schedules export-pdf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      employeeId: '1',
      name: '測試員工',
      department: '行政部',
    } as never);
  });

  it('rejects unauthenticated export requests', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const response = await POST(new NextRequest('http://localhost:3000/api/my-schedules/export-pdf', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        year: 2025,
        month: 4,
        schedules: [],
        user: {
          employeeId: 1,
          name: '測試員工',
          department: '行政部',
        },
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: '未授權' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects export requests for a different employee', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 1,
      userId: 10,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/my-schedules/export-pdf', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        year: 2025,
        month: 4,
        schedules: [],
        user: {
          employeeId: 2,
          name: '其他員工',
          department: '資訊部',
        },
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '只能匯出自己的班表' });
  });

  it('rejects malformed json payloads before generating HTML', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 1,
      userId: 10,
    } as never);

    const response = await POST(new NextRequest('http://localhost:3000/api/my-schedules/export-pdf', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: '{"year":',
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的班表匯出資料' });
  });
});