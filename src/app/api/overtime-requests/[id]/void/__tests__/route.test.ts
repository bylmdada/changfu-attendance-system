import { NextRequest } from 'next/server';
import { POST } from '@/app/api/overtime-requests/[id]/void/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getTaiwanYearMonth } from '@/lib/timezone';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    compLeaveBalance: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    compLeaveTransaction: {
      create: jest.fn(),
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

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/timezone', () => ({
  getTaiwanYearMonth: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedGetTaiwanYearMonth = getTaiwanYearMonth as jest.MockedFunction<typeof getTaiwanYearMonth>;

const transactionClient = {
  overtimeRequest: {
    update: jest.fn(),
  },
  compLeaveBalance: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  compLeaveTransaction: {
    create: jest.fn(),
  },
};

describe('overtime void guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);
    mockedGetTaiwanYearMonth.mockReturnValue('2026-04' as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects malformed ids before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/abc/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'admin void' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('加班申請 ID 格式錯誤');
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的加班作廢資料');
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed POST bodies before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: '{"reason":',
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
  });

  it('wraps comp-leave reversal and void update in a transaction', async () => {
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'APPROVED',
      compensationType: 'COMP_LEAVE',
      totalHours: 2,
    } as never);
    transactionClient.compLeaveBalance.findUnique.mockResolvedValue({ employeeId: 10 } as never);
    transactionClient.compLeaveBalance.update.mockResolvedValue({ employeeId: 10 } as never);
    transactionClient.compLeaveTransaction.create.mockResolvedValue({ id: 1 } as never);
    transactionClient.overtimeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5/void', {
      method: 'POST',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: '資料修正作廢' }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.compLeaveBalance.update).toHaveBeenCalled();
    expect(transactionClient.compLeaveTransaction.create).toHaveBeenCalled();
    expect(transactionClient.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          status: 'VOIDED',
          compLeaveReversed: true,
        }),
      })
    );
  });
});