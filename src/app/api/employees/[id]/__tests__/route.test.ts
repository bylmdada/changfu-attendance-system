jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      update: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    passwordHistory: {
      findMany: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
    payrollRecord: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { GET, PUT, DELETE } from '@/app/api/employees/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest, verifyPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockVerifyPassword = verifyPassword as jest.MockedFunction<typeof verifyPassword>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
let mockTxEmployeeUpdate: jest.Mock;
let mockTxUserUpdate: jest.Mock;
let mockTxUserCreate: jest.Mock;
let mockTxUserFindFirst: jest.Mock;
let mockTxEmployeeDelete: jest.Mock;
let mockTxUserDelete: jest.Mock;
let mockTxSalaryHistoryFindFirst: jest.Mock;
let mockTxSalaryHistoryCreate: jest.Mock;

describe('employee detail route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
      sessionId: 'session-1',
    } as never);

    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 10,
      employeeId: 'E010',
      name: '王小明',
      hireDate: new Date('2024-01-01T00:00:00.000Z'),
      baseSalary: 40000,
      hourlyRate: 167,
      employeeType: 'MONTHLY',
      user: { id: 50, username: 'wang', role: 'EMPLOYEE', isActive: true, passwordHash: 'old-hash' },
    } as never);
    mockVerifyPassword.mockResolvedValue(false as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue(null as never);
    mockPrisma.passwordHistory.findMany.mockResolvedValue([] as never);
    mockPrisma.payrollRecord.findMany.mockResolvedValue([] as never);
    mockTxEmployeeUpdate = jest.fn().mockResolvedValue({ id: 10, employeeId: 'E010', name: '王小明', isActive: true });
    mockTxUserUpdate = jest.fn().mockResolvedValue({ id: 50 });
    mockTxUserCreate = jest.fn().mockResolvedValue({ id: 50 });
    mockTxUserFindFirst = jest.fn().mockResolvedValue(null);
    mockTxEmployeeDelete = jest.fn().mockResolvedValue({ id: 10 });
    mockTxUserDelete = jest.fn().mockResolvedValue({ id: 50 });
    mockTxSalaryHistoryFindFirst = jest.fn().mockResolvedValue(null);
    mockTxSalaryHistoryCreate = jest.fn().mockResolvedValue({ id: 30 });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      employee: {
        update: mockTxEmployeeUpdate,
        delete: mockTxEmployeeDelete,
      },
      user: {
        update: mockTxUserUpdate,
        create: mockTxUserCreate,
        findFirst: mockTxUserFindFirst,
        delete: mockTxUserDelete,
      },
      salaryHistory: {
        findFirst: mockTxSalaryHistoryFindFirst,
        create: mockTxSalaryHistoryCreate,
      },
    } as never) as never);
  });

  it('rejects malformed id path segments instead of coercing them with parseInt', async () => {
    const response = await GET(new NextRequest('http://localhost/api/employees/10abc'), {
      params: Promise.resolve({ id: '10abc' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的員工ID' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects non-boolean isActive partial updates', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({ isActive: 'false' }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'isActive 參數格式無效' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('invalidates the existing session and records password history when updating an account password', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E010',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 40000,
        hourlyRate: 250,
        department: '行政部',
        position: '主任',
        createAccount: true,
        username: 'wang',
        password: 'Nex!Pass77',
        role: 'EMPLOYEE',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toBe('員工資料已更新');
    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 50 },
      data: expect.objectContaining({
        username: 'wang',
        currentSessionId: null,
        passwordHistories: {
          create: {
            passwordHash: 'old-hash'
          }
        }
      }),
    });
  });

  it('rejects malformed id path segments for delete requests as well', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/employees/10abc', {
      method: 'DELETE',
      headers: {
        'x-csrf-token': 'csrf-token',
      },
    }), {
      params: Promise.resolve({ id: '10abc' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的員工ID' });
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects permanent deletion of the current admin employee record', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/employees/10?mode=permanent', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        confirmationEmployeeId: 'E010',
        confirmationName: '王小明',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '不可刪除目前登入帳號所屬員工資料' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires exact confirmation payload before permanent employee deletion', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 99,
      role: 'ADMIN',
      username: 'admin',
      sessionId: 'session-1',
    } as never);

    const response = await DELETE(new NextRequest('http://localhost/api/employees/10?mode=permanent', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        confirmationEmployeeId: 'WRONG',
        confirmationName: '王小明',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '刪除確認資訊不一致，已取消操作' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('blocks permanent deletion when employee history exists', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 99,
      role: 'ADMIN',
      username: 'admin',
      sessionId: 'session-1',
    } as never);
    mockPrisma.employee.findUnique
      .mockResolvedValueOnce({
        id: 10,
        employeeId: 'E010',
        name: '王小明',
        user: { id: 50, username: 'wang', role: 'EMPLOYEE', isActive: true },
      } as never)
      .mockResolvedValueOnce({
        attendancePermission: null,
        compLeaveBalance: null,
        resignationSettlement: null,
        notificationSettings: null,
        user: { id: 50, _count: {
          createdGPSPermissions: 0,
          approvedMissedClockRequests: 0,
          createdPasswordExceptions: 0,
          auditLogs: 0,
          loginLogs: 0,
        } },
        _count: {
          annualLeaves: 0,
          leaveRequests: 0,
          overtimeRequests: 0,
          attendanceRecords: 2,
          payrollRecords: 1,
          announcements: 0,
          schedules: 0,
          passwordExceptions: 0,
          shiftExchangeRequestsMade: 0,
          shiftExchangeRequestsTarget: 0,
          shiftExchangeRequestsApproved: 0,
          gpsPermissions: 0,
          approvedLeaveRequests: 0,
          approvedOvertimeRequests: 0,
          attendanceFreezes: 0,
          annualBonusRecords: 0,
          bonusRecords: 0,
          createdBonusRecords: 0,
          healthInsuranceDependents: 0,
          missedClockRequests: 0,
          auditLogs: 0,
          compLeaveTransactions: 0,
          processedSettlements: 0,
          resignationRecords: 0,
          overtimeClockRecords: 0,
          delegatedFrom: 0,
          delegatedTo: 0,
          notifications: 0,
          purchaseRequests: 0,
          approvedPurchaseRequests: 0,
          leaveBalanceHistory: 0,
          inAppNotifications: 0,
          holidayCompensations: 0,
          payrollDisputes: 0,
          reviewedDisputes: 0,
          createdAdjustments: 0,
          createdDisasterDayOffs: 0,
          departmentManagers: 0,
          managerDeputies: 0,
          approvalReviews: 0,
          ccsSent: 0,
          ccsReceived: 0,
          salaryHistories: 0,
          approvedSalaryChanges: 0,
          scheduleReleases: 0,
          scheduleConfirmations: 0,
          pensionApplications: 0,
          reviewedPensionApps: 0,
          approvedPensionApps: 0,
        },
      } as never);

    const response = await DELETE(new NextRequest('http://localhost/api/employees/10?mode=permanent', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        confirmationEmployeeId: 'E010',
        confirmationName: '王小明',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain('歷史資料');
    expect(payload.blockers).toEqual(expect.arrayContaining(['考勤記錄 2 筆', '薪資記錄 1 筆']));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists editable employee fields and allows manager role updates without forcing a password reset', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E010',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 40000,
        hourlyRate: 250,
        department: '行政部',
        position: '主任',
        employeeType: 'HOURLY',
        laborInsuranceActive: false,
        email: 'wang@example.com',
        createAccount: true,
        username: 'wang',
        password: '',
        role: 'MANAGER',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toBe('員工資料已更新');
    expect(mockTxEmployeeUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        email: 'wang@example.com',
        employeeType: 'HOURLY',
        laborInsuranceActive: false,
      }),
    });
    expect(mockTxUserUpdate).toHaveBeenCalledWith({
      where: { id: 50 },
      data: {
        username: 'wang',
        role: 'MANAGER',
      },
    });
    expect(mockTxUserCreate).not.toHaveBeenCalled();
  });

  it('recalculates rounded hourly rate for monthly employees when updating records', async () => {
    mockPrisma.payrollRecord.findMany.mockResolvedValue([
      { payYear: 2026, payMonth: 7 },
    ] as never);
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E010',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 40100,
        hourlyRate: 999,
        department: '行政部',
        position: '主任',
        employeeType: 'MONTHLY',
        createAccount: false,
        role: 'EMPLOYEE',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.payrollWarning).toBe('此申請影響的 2026/07 薪資已產生，請薪資管理員人工處理差額');
    expect(mockTxEmployeeUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        baseSalary: 40100,
        hourlyRate: 167,
        employeeType: 'MONTHLY',
      }),
    });
    expect(mockTxSalaryHistoryFindFirst).toHaveBeenCalledWith({
      where: { employeeId: 10 },
      select: { id: true },
    });
    expect(mockTxSalaryHistoryCreate).toHaveBeenNthCalledWith(1, {
      data: {
        employeeId: 10,
        effectiveDate: new Date('2024-01-01T00:00:00.000Z'),
        baseSalary: 40000,
        hourlyRate: 167,
        adjustmentType: 'INITIAL',
        reason: '入職薪資',
        approvedById: 10,
      },
    });
    expect(mockTxSalaryHistoryCreate).toHaveBeenNthCalledWith(2, {
      data: {
        employeeId: 10,
        effectiveDate: expect.any(Date),
        baseSalary: 40100,
        hourlyRate: 167,
        previousSalary: 40000,
        adjustmentAmount: 100,
        adjustmentType: 'ADJUSTMENT',
        reason: '員工資料維護',
        approvedById: 10,
      },
    });
  });

  it('keeps manual hourly rate for hourly employees when updating records', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E010',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 0,
        hourlyRate: 190,
        department: '行政部',
        position: '主任',
        employeeType: 'HOURLY',
        createAccount: false,
        role: 'EMPLOYEE',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });

    expect(response.status).toBe(200);
    expect(mockTxEmployeeUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        baseSalary: 0,
        hourlyRate: 190,
        employeeType: 'HOURLY',
      }),
    });
  });

  it('rejects weak passwords before updating an existing account', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/employees/10', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        employeeId: 'E010',
        name: '王小明',
        birthday: '1990-01-01',
        hireDate: '2024-01-01',
        baseSalary: 40000,
        hourlyRate: 250,
        department: '行政部',
        position: '主任',
        createAccount: true,
        username: 'wang',
        password: '123',
        role: 'EMPLOYEE',
      }),
    }), {
      params: Promise.resolve({ id: '10' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: '密碼不符合安全要求',
      details: expect.arrayContaining(['密碼長度至少需要6位', '這是常見的弱密碼'])
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
