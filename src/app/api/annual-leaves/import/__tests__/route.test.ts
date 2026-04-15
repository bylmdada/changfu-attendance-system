jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
    },
    annualLeave: {
      upsert: jest.fn(),
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

jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: {
    sheet_to_json: jest.fn(),
    book_new: jest.fn(),
    aoa_to_sheet: jest.fn(),
    book_append_sheet: jest.fn(),
  },
  write: jest.fn(),
  SSF: {
    parse_date_code: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import * as XLSX from 'xlsx';
import { POST } from '../route';

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedRead = XLSX.read as jest.Mock;
const mockedSheetToJson = XLSX.utils.sheet_to_json as jest.Mock;
const mockedParseDateCode = XLSX.SSF.parse_date_code as jest.Mock;

function createImportRequest(fileName = 'annual-leave-import.xlsx') {
  const formData = new FormData();
  formData.append(
    'file',
    new File([new Uint8Array([1, 2, 3])], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  );

  return new NextRequest('http://localhost:3000/api/annual-leaves/import', {
    method: 'POST',
    headers: {
      cookie: 'token=session-token',
    },
    body: formData,
  });
}

describe('annual leave import csrf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);
    mockedGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1, userId: 1 } as never);
    mockedPrisma.employee.findMany.mockResolvedValue([
      {
        id: 10,
        employeeId: 'A001',
        hireDate: new Date('2020-01-01T00:00:00.000Z'),
      },
    ] as never);
    mockedPrisma.annualLeave.upsert.mockResolvedValue({ id: 99 } as never);
    mockedRead.mockReturnValue({
      SheetNames: ['Sheet1'],
      Sheets: { Sheet1: {} },
    });
    mockedParseDateCode.mockReturnValue({ y: 2025, m: 6, d: 30 });
  });

  it('rejects POST requests with an invalid CSRF token', async () => {
    const request = createImportRequest();

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('converts Excel numeric expiry dates into valid Date objects during import', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedSheetToJson.mockReturnValue([
      ['員工編號', '年度', '已使用天數', '剩餘天數', '到期日'],
      ['A001', 2024, 5, 10, 45838],
    ]);

    const request = createImportRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results.success).toBe(1);
    expect(mockedPrisma.annualLeave.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          expiryDate: new Date(2025, 5, 30),
        }),
      })
    );
  });

  it('rejects rows with malformed remaining days before hitting Prisma', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedSheetToJson.mockReturnValue([
      ['員工編號', '年度', '已使用天數', '剩餘天數', '到期日'],
      ['A001', 2024, 5, 'oops', '2025-06-30'],
    ]);

    const request = createImportRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results.success).toBe(0);
    expect(data.results.failed).toBe(1);
    expect(data.results.errors).toContain('第 2 行：剩餘天數格式不正確');
    expect(mockedPrisma.annualLeave.upsert).not.toHaveBeenCalled();
  });

  it('rejects rows with malformed year strings before hitting Prisma', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedSheetToJson.mockReturnValue([
      ['員工編號', '年度', '已使用天數', '剩餘天數', '到期日'],
      ['A001', '2024abc', 5, 10, '2025-06-30'],
    ]);

    const request = createImportRequest();
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.results.success).toBe(0);
    expect(data.results.failed).toBe(1);
    expect(data.results.errors).toContain('第 2 行：年度格式不正確');
    expect(mockedPrisma.annualLeave.upsert).not.toHaveBeenCalled();
  });
});