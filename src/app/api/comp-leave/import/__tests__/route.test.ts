jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
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

import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { POST } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

const transactionClient = {
  compLeaveBalance: {
    upsert: jest.fn(),
  },
  compLeaveTransaction: {
    deleteMany: jest.fn(),
    create: jest.fn(),
  },
};

describe('comp leave import route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', userId: 1, employeeId: 1 } as never);
    mockPrisma.employee.findMany.mockResolvedValue([
      { id: 10, employeeId: 'A001' },
    ] as never);
    (mockPrisma.$transaction as jest.Mock).mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient));
  });

  it('replaces previous import baseline rows before writing the new snapshot transaction', async () => {
    transactionClient.compLeaveBalance.upsert.mockResolvedValue({ id: 1 } as never);
    transactionClient.compLeaveTransaction.deleteMany.mockResolvedValue({ count: 1 } as never);
    transactionClient.compLeaveTransaction.create.mockResolvedValue({ id: 2 } as never);

    const formData = new FormData();
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['員工編號', '餘額(小時)', '說明'],
      ['A001', 16, '舊系統轉移'],
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, '補休餘額匯入');

    formData.append(
      'file',
      new File(
        [XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })],
        'comp-leave.xlsx',
        {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
      )
    );

    const request = {
      headers: new Headers(),
      formData: async () => formData,
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(transactionClient.compLeaveTransaction.deleteMany).toHaveBeenCalledWith({
      where: {
        employeeId: 10,
        referenceType: 'IMPORT',
      },
    });
    expect(transactionClient.compLeaveTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: 10,
          transactionType: 'EARN',
          referenceType: 'IMPORT',
          hours: 16,
        }),
      })
    );
  });

  it('rejects POST requests with an invalid CSRF token', async () => {
    mockValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost:3000/api/comp-leave/import', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockGetUserFromRequest).not.toHaveBeenCalled();
  });
});