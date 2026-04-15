import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, getUserFromToken } from '@/lib/auth';
import { cookies } from 'next/headers';
import { decrypt } from '@/lib/encryption';
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
    mockedXlsxWrite.mockReturnValue(Buffer.from('xls-binary') as never);

    mockedPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'EMP001',
        name: '王小明',
        department: 'HR',
        idNumber: 'A123456789',
        bankAccount: '123456789012',
      },
    ] as never);

    mockedPrisma.payrollRecord.findMany.mockResolvedValue([
      {
        employeeId: 1,
        netPay: 39000,
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
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
  });
});