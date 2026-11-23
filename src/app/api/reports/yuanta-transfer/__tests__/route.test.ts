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

  it('requires an explicit pay month instead of silently using the current month', async () => {
    const request = new NextRequest('http://localhost/api/reports/yuanta-transfer?year=2026&type=salary', {
      headers: { cookie: 'token=shared-session-token' },
    });

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '請指定發薪月份' });
    expect(mockedPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
  });

  describe('department and employee filters', () => {
    const makeRecord = (id: number, employeeId: string, name: string, department: string | null, netPay: number) => ({
      employeeId: id,
      netPay,
      employee: { id, employeeId, name, department, idNumber: 'A123456789', bankAccount: '123456789012' },
    });

    const get = (query = '') =>
      GET(new NextRequest(`http://localhost/api/reports/yuanta-transfer?year=2026&month=3&type=salary${query}`, {
        headers: { cookie: 'token=shared-session-token' },
      }));

    const workbookRows = () =>
      (XLSX.utils.aoa_to_sheet as jest.Mock).mock.calls.flatMap(([rows]) => rows as unknown[][]);
    const sheetNames = () =>
      (XLSX.utils.book_append_sheet as jest.Mock).mock.calls.map(([, , name]) => name);

    beforeEach(() => {
      mockedPrisma.payrollRecord.findMany.mockResolvedValue([
        makeRecord(1, 'EMP001', '王小明', 'HR', 39000),
        makeRecord(2, 'EMP002', '李小華', 'IT', 41000),
        makeRecord(3, 'EMP003', '陳大文', null, 35000),
      ] as never);
    });

    it('exports every department when no filter is given', async () => {
      const response = await get();

      expect(response.status).toBe(200);
      expect(sheetNames().sort()).toEqual(['HR', 'IT', '未分類'].sort());
    });

    it('limits both the json preview and the excel workbook to the selected department', async () => {
      const preview = await (await get('&format=json&department=HR')).json();

      expect(preview.records.map((record: { employeeId: string }) => record.employeeId)).toEqual(['EMP001']);
      expect(preview.summary).toEqual(expect.objectContaining({ totalRecords: 1, totalAmount: 39000 }));

      const excel = await get('&department=HR');

      expect(excel.status).toBe(200);
      expect(sheetNames()).toEqual(['HR']);
      expect(workbookRows().some((row) => row.includes('李小華'))).toBe(false);
      expect(workbookRows().some((row) => row.includes('王小明'))).toBe(true);
    });

    it('matches the unassigned department label shown in the preview', async () => {
      const preview = await (await get(`&format=json&department=${encodeURIComponent('未分類')}`)).json();

      expect(preview.records.map((record: { employeeId: string }) => record.employeeId)).toEqual(['EMP003']);
    });

    it.each([
      ['employee number, case-insensitive', 'emp002', ['EMP002']],
      ['name fragment', encodeURIComponent('王'), ['EMP001']],
    ])('filters by %s', async (_label, search, expected) => {
      const preview = await (await get(`&format=json&search=${search}`)).json();

      expect(preview.records.map((record: { employeeId: string }) => record.employeeId)).toEqual(expected);
    });

    it('combines department and employee filters', async () => {
      const response = await get('&format=json&department=HR&search=EMP002');

      expect(response.status).toBe(404);
    });

    it('returns 404 naming the filter when nothing matches', async () => {
      const response = await get('&format=json&department=Nope');
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('2026年3月沒有符合條件的薪資記錄');
    });
  });
});
