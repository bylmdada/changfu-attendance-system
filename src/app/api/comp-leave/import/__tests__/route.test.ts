jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
    },
    compLeaveBalance: {
      findUnique: jest.fn(),
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
  describe('餘額欄位驗證', () => {
    const importRows = async (rows: unknown[][]) => {
      const formData = new FormData();
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['員工編號', '餘額(小時)', '說明'], ...rows]), '補休餘額匯入');
      formData.append('file', new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'comp-leave.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const response = await POST({ headers: new Headers(), formData: async () => formData } as unknown as NextRequest);
      return response.json();
    };

    beforeEach(() => {
      transactionClient.compLeaveBalance.upsert.mockResolvedValue({ id: 1 } as never);
      transactionClient.compLeaveTransaction.deleteMany.mockResolvedValue({ count: 0 } as never);
      transactionClient.compLeaveTransaction.create.mockResolvedValue({ id: 2 } as never);
      mockPrisma.compLeaveBalance.findUnique.mockResolvedValue({ balance: 8 } as never);
    });

    it('treats a blank balance as an error and leaves the existing balance untouched', async () => {
      const payload = await importRows([['A001', undefined, '舊系統轉移']]);

      expect(payload.results).toEqual({
        success: 0,
        failed: 1,
        errors: [expect.stringMatching(/第 2 行：員工 A001 餘額欄是空白，要歸零請明確填 0.*現有餘額 8 小時維持不變/)],
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(transactionClient.compLeaveBalance.upsert).not.toHaveBeenCalled();
      expect(transactionClient.compLeaveTransaction.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects mixed text such as "3hrs" instead of reading it as 3', async () => {
      const payload = await importRows([['A001', '3hrs', '舊系統轉移']]);

      expect(payload.results.failed).toBe(1);
      expect(payload.results.errors[0]).toContain('餘額格式不正確（3hrs）');
      expect(transactionClient.compLeaveBalance.upsert).not.toHaveBeenCalled();
    });

    it('rejects negative and non-finite values', async () => {
      const payload = await importRows([['A001', -2, 'x'], ['A001', 'Infinity', 'x'], ['A001', '1e3', 'x']]);

      expect(payload.results.failed).toBe(3);
      expect(transactionClient.compLeaveBalance.upsert).not.toHaveBeenCalled();
    });

    it('still imports an explicit 0 (zero it out) and half hours, including numbers typed as text', async () => {
      const payload = await importRows([['A001', 0, '歸零'], ['A001', 0.5, '半小時'], ['A001', ' 12.5 ', '文字數字']]);

      expect(payload.results).toEqual({ success: 3, failed: 0, errors: [] });
      const importedHours = transactionClient.compLeaveTransaction.create.mock.calls.map(
        (call: [{ data: { hours: number } }]) => call[0].data.hours
      );
      expect(importedHours).toEqual([0, 0.5, 12.5]);
    });

    it('imports the valid rows and reports only the bad one with its row number', async () => {
      const payload = await importRows([['A001', 16, 'ok'], ['A001', undefined, 'blank'], ['A001', 4, 'ok']]);

      expect(payload.results.success).toBe(2);
      expect(payload.results.failed).toBe(1);
      expect(payload.results.errors[0]).toMatch(/^第 3 行/);
    });
  });
});
