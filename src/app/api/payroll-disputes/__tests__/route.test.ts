import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/payroll-disputes/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';

jest.mock('@/lib/database', () => ({
  prisma: {
    payrollDispute: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    payrollRecord: {
      findFirst: jest.fn(),
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

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCreateApprovalForRequest = createApprovalForRequest as jest.MockedFunction<typeof createApprovalForRequest>;

describe('payroll disputes route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'EMPLOYEE',
      username: 'employee',
    } as never);
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.payrollDispute.findMany.mockResolvedValue([] as never);
    mockPrisma.payrollDispute.findFirst.mockResolvedValue(null as never);
    mockPrisma.payrollRecord.findFirst.mockResolvedValue({ id: 12 } as never);
    mockPrisma.payrollDispute.create.mockResolvedValue({
      id: 20,
      employee: { id: 10, name: '測試員工', department: 'HR' },
    } as never);
    mockCreateApprovalForRequest.mockResolvedValue(undefined as never);
  });

  it('returns 400 on GET when year is malformed', async () => {
    const response = await GET(new NextRequest('http://localhost/api/payroll-disputes?year=abc'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('year 格式錯誤');
  });

  it('returns 400 on GET when month is malformed', async () => {
    const response = await GET(new NextRequest('http://localhost/api/payroll-disputes?month=13'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('month 格式錯誤');
  });

  it('returns 400 on POST when body is null', async () => {
    const response = await POST(new NextRequest('http://localhost/api/payroll-disputes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的異議資料');
  });

  it('returns 400 on POST when body contains malformed JSON', async () => {
    const response = await POST(new NextRequest('http://localhost/api/payroll-disputes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"payYear":',
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.payrollRecord.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.payrollDispute.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when payYear is malformed', async () => {
    const response = await POST(new NextRequest('http://localhost/api/payroll-disputes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payYear: '20xx',
        payMonth: 4,
        type: 'OVERTIME_MISSING',
        description: 'test',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('payYear 格式錯誤');
  });

  it('returns 400 on POST when payMonth is malformed', async () => {
    const response = await POST(new NextRequest('http://localhost/api/payroll-disputes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payYear: 2026,
        payMonth: '99',
        type: 'OVERTIME_MISSING',
        description: 'test',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('payMonth 格式錯誤');
  });

  it('returns 400 on POST when requestedAmount is malformed', async () => {
    const response = await POST(new NextRequest('http://localhost/api/payroll-disputes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payYear: 2026,
        payMonth: 4,
        type: 'OVERTIME_MISSING',
        description: 'test',
        requestedAmount: 'abc',
      }),
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('requestedAmount 格式錯誤');
  });
});