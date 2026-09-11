import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { cookies } from 'next/headers';
import { decrypt, validateTaiwanIdNumber } from '@/lib/encryption';
import * as XLSX from 'xlsx';

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
    },
    payrollRecord: {
      findMany: jest.fn(),
    },
    bonusRecord: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  getUserFromToken: jest.fn(),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/encryption', () => ({
  decrypt: jest.fn(),
  validateTaiwanIdNumber: jest.fn(),
}));

jest.mock('xlsx', () => ({
  utils: {
    book_new: jest.fn(() => ({ sheets: [] })),
    aoa_to_sheet: jest.fn(() => ({})),
    book_append_sheet: jest.fn(),
  },
  write: jest.fn(() => Buffer.from('xls-binary')),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedGetUserFromToken = getUserFromToken as jest.MockedFunction<typeof getUserFromToken>;
const mockedCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockedDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;
const mockedValidateTaiwanIdNumber = validateTaiwanIdNumber as jest.MockedFunction<typeof validateTaiwanIdNumber>;
const mockedXlsxWrite = XLSX.write as jest.MockedFunction<typeof XLSX.write>;

describe('yuanta transfer route auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedCookies.mockResolvedValue({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as Awaited<ReturnType<typeof cookies>>);

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    });

    mockedGetUserFromToken.mockResolvedValue({
      userId: 1,
      employeeId: 1,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    });

    mockedDecrypt.mockImplementation((value: string) => value);
    mockedValidateTaiwanIdNumber.mockReturnValue(true);
    mockedXlsxWrite.mockReturnValue(Buffer.from('xls-binary') as never);

    mockedPrisma.payrollRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        netPay: 39000,
        employee: {
          id: 1,
          employeeId: 'EMP001',
          name: '王小明',
          department: 'HR',
          idNumber: 'A123456789',
          bankAccount: '123456789012',
        },
      },
    ] as never);

    mockedPrisma.bonusRecord.findMany.mockResolvedValue([] as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost/api/reports/yuanta-transfer?year=2026&month=3&type=salary', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/vnd.ms-excel');
  });

  it.each([
    ['http://localhost/api/reports/yuanta-transfer?year=abc&month=3&type=salary', '無效的年份參數'],
    ['http://localhost/api/reports/yuanta-transfer?year=2026&month=13&type=salary', '無效的月份參數'],
    ['http://localhost/api/reports/yuanta-transfer?year=2026&month=3&type=salary&date=20260399', '無效的轉帳日期參數'],
    ['http://localhost/api/reports/yuanta-transfer?year=2026&month=3&type=other', '無效的匯出類型參數'],
  ])('returns 400 for invalid query params: %s', async (url, expectedError) => {
    const request = new NextRequest(url, {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: expectedError });
    expect(mockedPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });

  it('returns JSON preview records with validated payroll transfer data', async () => {
    const request = new NextRequest('http://localhost/api/reports/yuanta-transfer?year=2026&month=3&type=salary&format=json', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.records).toEqual([
      expect.objectContaining({
        employeeId: 'EMP001',
        idNumber: 'A123456789',
        bankAccount: '123456789012',
        amount: 39000,
        name: '王小明',
      }),
    ]);
    expect(data.summary).toEqual(expect.objectContaining({
      totalRecords: 1,
      totalAmount: 39000,
      incompleteRecords: 0,
    }));
  });

  it('filters year-end bonus transfer exports by selected month', async () => {
    mockedPrisma.payrollRecord.findMany.mockResolvedValue([] as never);
    mockedPrisma.bonusRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        amount: 52000,
        employee: {
          id: 1,
          employeeId: 'EMP001',
          name: '王小明',
          department: 'HR',
          idNumber: 'A123456789',
          bankAccount: '123456789012',
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/reports/yuanta-transfer?year=2026&month=2&type=bonus&format=json', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockedPrisma.bonusRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payrollYear: 2026,
          payrollMonth: 2,
          bonusType: 'YEAR_END',
        }),
      })
    );
    expect(data.summary).toEqual(expect.objectContaining({
      totalAmount: 52000,
    }));
  });

  it('returns exportable records with blank fields and warnings when payroll transfer data is incomplete', async () => {
    mockedPrisma.payrollRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        netPay: 39000,
        employee: {
          id: 1,
          employeeId: 'EMP001',
          name: '王小明',
          department: 'HR',
          idNumber: null,
          bankAccount: '123',
        },
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/reports/yuanta-transfer?year=2026&month=3&type=salary&format=json', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.records).toEqual([
      expect.objectContaining({
        employeeId: 'EMP001',
        idNumber: '',
        bankAccount: '',
        amount: 39000,
      }),
    ]);
    expect(data.warnings).toEqual([
      expect.objectContaining({
        employeeId: 'EMP001',
        reasons: expect.arrayContaining(['缺少身分證字號', '薪轉元大銀行帳號格式不正確']),
      }),
    ]);
    expect(data.summary).toEqual(expect.objectContaining({
      incompleteRecords: 1,
      totalRecords: 1,
    }));
  });
});
