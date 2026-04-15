jest.mock('@/lib/database', () => ({
  prisma: {
    dependentApplication: {
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

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { PUT } from '@/app/api/dependent-applications/route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('dependent applications review body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'HR',
      userId: 1,
      employeeId: 1,
      username: 'reviewer',
    } as never);
  });

  it('rejects malformed PUT bodies before querying applications', async () => {
    const request = new NextRequest('http://localhost:3000/api/dependent-applications', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: '{"id":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.dependentApplication.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null PUT bodies before querying applications', async () => {
    const request = new NextRequest('http://localhost:3000/api/dependent-applications', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的眷屬申請審核資料' });
    expect(mockPrisma.dependentApplication.findUnique).not.toHaveBeenCalled();
  });
});