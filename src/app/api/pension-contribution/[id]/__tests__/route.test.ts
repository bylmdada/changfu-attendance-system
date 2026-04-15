import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { DELETE, GET, PUT } from '@/app/api/pension-contribution/[id]/route';

jest.mock('@/lib/database', () => ({
  prisma: {
    pensionContributionApplication: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employee: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('pension contribution detail route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
  });

  it('returns 400 when GET route id is not a strict positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/pension-contribution/5abc');

    const response = await GET(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請ID格式無效' });
    expect(mockPrisma.pensionContributionApplication.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT route id is not a strict positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/pension-contribution/5abc', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'APPROVE' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請ID格式無效' });
    expect(mockPrisma.pensionContributionApplication.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT body JSON is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/pension-contribution/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"action":"APPROVE"',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請求內容格式無效' });
    expect(mockPrisma.pensionContributionApplication.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when DELETE route id is not a strict positive integer', async () => {
    const request = new NextRequest('http://localhost:3000/api/pension-contribution/5abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請ID格式無效' });
    expect(mockPrisma.pensionContributionApplication.findUnique).not.toHaveBeenCalled();
  });
});