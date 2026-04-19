import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { DELETE, GET, PATCH, PUT } from '@/app/api/pension-contribution/[id]/route';

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

const transactionClient = {
  pensionContributionApplication: {
    update: jest.fn(),
  },
  employee: {
    update: jest.fn(),
  },
};

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
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
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

  it('allows HR review with opinion on pending HR applications', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 2,
      employeeId: 20,
      username: 'hr-user',
      role: 'HR',
      sessionId: 'session-2',
    } as never);
    mockPrisma.pensionContributionApplication.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      requestedRate: 3.5,
      effectiveDate: new Date('2026-05-01T00:00:00.000Z'),
      status: 'PENDING_HR',
      employee: {
        id: 10,
        name: '王小明',
        laborPensionSelfRate: 1,
      },
    } as never);
    mockPrisma.pensionContributionApplication.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/pension-contribution/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE', note: '資料完整' }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.pensionContributionApplication.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        status: 'PENDING_ADMIN',
        hrReviewerId: 20,
        hrOpinion: 'AGREE',
        hrNote: '資料完整',
      }),
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('supports PATCH as an alias of PUT for pension review updates', async () => {
    mockPrisma.pensionContributionApplication.findUnique.mockResolvedValue({
      id: 6,
      employeeId: 10,
      requestedRate: 4,
      effectiveDate: new Date('2099-05-01T00:00:00.000Z'),
      status: 'PENDING_HR',
      employee: {
        id: 10,
        name: '王小明',
        laborPensionSelfRate: 1,
      },
    } as never);
    transactionClient.pensionContributionApplication.update.mockResolvedValue({ id: 6 } as never);
    transactionClient.employee.update.mockResolvedValue({ id: 10 } as never);

    const request = new NextRequest('http://localhost:3000/api/pension-contribution/6', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'APPROVE', note: '直接核准' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '6' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.pensionContributionApplication.update).toHaveBeenCalledWith({
      where: { id: 6 },
      data: expect.objectContaining({
        status: 'APPROVED',
        adminApproverId: 10,
        adminNote: '直接核准',
      }),
    });
    expect(transactionClient.employee.update).not.toHaveBeenCalled();
  });
});
