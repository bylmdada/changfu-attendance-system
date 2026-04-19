import { NextRequest } from 'next/server';
import { DELETE, PATCH } from '@/app/api/overtime-requests/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { notifyOvertimeApproval } from '@/lib/email';
import { calculateOvertimePayForRequest } from '@/lib/salary-utils';
import { getTaiwanYearMonth, toTaiwanDateStr } from '@/lib/timezone';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    compLeaveTransaction: {
      create: jest.fn(),
    },
    compLeaveBalance: {
      upsert: jest.fn(),
    },
    departmentManager: {
      findMany: jest.fn(),
    },
    employee: {
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

jest.mock('@/lib/email', () => ({
  notifyOvertimeApproval: jest.fn(),
}));

jest.mock('@/lib/salary-utils', () => ({
  calculateOvertimePayForRequest: jest.fn(),
}));

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn(),
  getTaiwanYearMonth: jest.fn(),
}));

jest.mock('@/lib/hr-notification', () => ({
  notifyHRAfterManagerReview: jest.fn(),
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn(),
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedNotifyOvertimeApproval = notifyOvertimeApproval as jest.MockedFunction<typeof notifyOvertimeApproval>;
const mockedCalculateOvertimePayForRequest = calculateOvertimePayForRequest as jest.MockedFunction<typeof calculateOvertimePayForRequest>;
const mockedGetTaiwanYearMonth = getTaiwanYearMonth as jest.MockedFunction<typeof getTaiwanYearMonth>;
const mockedToTaiwanDateStr = toTaiwanDateStr as jest.MockedFunction<typeof toTaiwanDateStr>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

const transactionClient = {
  overtimeRequest: {
    update: jest.fn(),
  },
  compLeaveTransaction: {
    create: jest.fn(),
  },
  compLeaveBalance: {
    upsert: jest.fn(),
  },
};

describe('overtime request item csrf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });
  });

  it('rejects PATCH requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'update' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('rejects DELETE requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on DELETE before querying Prisma', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/abc', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: 'abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('加班申請 ID 格式錯誤');
  });

  it('rejects null PATCH bodies before parsing overtime payload', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的加班申請資料');
  });

  it('rejects malformed PATCH bodies before parsing overtime payload', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: '{"reason":',
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
  });
});

describe('overtime request item approval consistency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 88,
      userId: 777,
    } as never);
    mockedNotifyOvertimeApproval.mockResolvedValue(undefined as never);
    mockedCalculateOvertimePayForRequest.mockResolvedValue({ success: true, overtimePay: 600, hourlyRate: 200 } as never);
    mockedGetTaiwanYearMonth.mockReturnValue('2026-04' as never);
    mockedToTaiwanDateStr.mockReturnValue('2026/04/01' as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING_ADMIN',
      compensationType: 'COMP_LEAVE',
      totalHours: 2,
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      reason: '結帳支援',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: '王小明',
        department: '門市',
        position: '店員',
        email: 'user@example.com',
      },
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
    transactionClient.overtimeRequest.update.mockResolvedValue({ id: 5 } as never);
    transactionClient.compLeaveTransaction.create.mockResolvedValue({ id: 1 } as never);
    transactionClient.compLeaveBalance.upsert.mockResolvedValue({ id: 1 } as never);
  });

  it('wraps approved comp-leave accrual in a transaction', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 88,
        }),
      })
    );
    expect(transactionClient.compLeaveTransaction.create).toHaveBeenCalled();
    expect(transactionClient.compLeaveBalance.upsert).toHaveBeenCalled();
  });

  it('rejects overtime-pay approvals when overtime pay calculation fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING_ADMIN',
      compensationType: 'OVERTIME_PAY',
      totalHours: 2,
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      reason: '結帳支援',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: '王小明',
        department: '門市',
        position: '店員',
        email: 'user@example.com',
      },
    } as never);
    mockedCalculateOvertimePayForRequest.mockResolvedValue({ success: false, error: 'rate unavailable' } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED', overtimeType: 'REST_DAY' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('加班費計算失敗：rate unavailable');
    expect(mockedCalculateOvertimePayForRequest).toHaveBeenCalledWith(
      10,
      new Date('2026-04-01T00:00:00.000Z'),
      2,
      'REST_DAY'
    );
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedNotifyOvertimeApproval).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('計算加班費失敗:', 'rate unavailable');

    consoleErrorSpy.mockRestore();
  });

  it('allows HR to finalize overtime requests', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'HR',
      employeeId: 66,
      userId: 666,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'APPROVED' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(transactionClient.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 66,
        }),
      })
    );
  });
});
