import { NextRequest } from 'next/server';
import { POST } from '@/app/api/batch-approve/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { calculateOvertimePayForRequest } from '@/lib/salary-utils';

jest.mock('@/lib/database', () => ({
  prisma: {
    leaveRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    overtimeRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    shiftExchangeRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    schedule: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    compLeaveTransaction: {
      create: jest.fn(),
    },
    compLeaveBalance: {
      upsert: jest.fn(),
    },
    annualLeave: {
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
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

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
}));

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn(),
}));

jest.mock('@/lib/salary-utils', () => ({
  calculateOvertimePayForRequest: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;
const mockCalculateOvertimePayForRequest = calculateOvertimePayForRequest as jest.MockedFunction<typeof calculateOvertimePayForRequest>;

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
  leaveRequest: {
    update: jest.fn(),
  },
  annualLeave: {
    updateMany: jest.fn(),
  },
  shiftExchangeRequest: {
    update: jest.fn(),
  },
  schedule: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};
function resetNestedMockFunctions(record: Record<string, unknown>) {
  for (const value of Object.values(record)) {
    if (typeof value === 'function' && 'mockReset' in value) {
      (value as jest.Mock).mockReset();
      continue;
    }

    if (value && typeof value === 'object') {
      resetNestedMockFunctions(value as Record<string, unknown>);
    }
  }
}

describe('batch approve supervisor scope guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNestedMockFunctions(transactionClient as unknown as Record<string, unknown>);

    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 7,
      employeeId: 70,
      role: 'SUPERVISOR',
      username: 'supervisor',
    } as never);
    mockGetManageableDepartments.mockResolvedValue(['製造部'] as never);
    mockCheckAttendanceFreeze.mockResolvedValue({ isFrozen: false } as never);
    mockPrisma.auditLog.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects HR users so combined batch approval cannot bypass admin-only final review flows', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 50,
      role: 'HR',
      username: 'hr-user',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [999],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: '需要管理員或主管審核權限' });
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects out-of-scope leave requests for supervisors', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 100,
      status: 'PENDING',
      employee: {
        department: '財務部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [100],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無權限審核其他部門的申請');
    expect(payload.failedIds).toEqual([100]);
    expect(payload.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
    });
    expect(payload.results).toEqual([
      { id: 100, success: false, error: '無權限審核其他部門的申請' },
    ]);
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('fails closed when every selected leave request fails review and keeps failure details', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 101,
      status: 'PENDING',
      employee: {
        department: '財務部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [101],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      error: '無權限審核其他部門的申請',
      summary: {
        total: 1,
        success: 0,
        failed: 1,
      },
      failedIds: [101],
      results: [
        { id: 101, success: false, error: '無權限審核其他部門的申請' },
      ],
    });
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('returns failedIds when a batch leave approval partially succeeds', async () => {
    mockPrisma.leaveRequest.findUnique
      .mockResolvedValueOnce({
        id: 108,
        status: 'PENDING',
        leaveType: 'SICK_LEAVE',
        employeeId: 58,
        startDate: new Date('2026-04-07T00:00:00.000Z'),
        endDate: new Date('2026-04-07T00:00:00.000Z'),
        employee: {
          department: '製造部',
        },
      } as never)
      .mockResolvedValueOnce({
        id: 100,
        status: 'PENDING',
        employee: {
          department: '財務部',
        },
      } as never);
    mockPrisma.leaveRequest.update.mockResolvedValue({ id: 108 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [108, 100],
        action: 'APPROVE',
        notes: '主管同意',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 2,
      success: 1,
      failed: 1,
    });
    expect(payload.failedIds).toEqual([100]);
    expect(payload.results).toEqual([
      { id: 108, success: true },
      { id: 100, success: false, error: '無權限審核其他部門的申請' },
    ]);
  });

  it('allows MANAGER role users to batch approve in-scope leave requests at the manager review stage', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 8,
      employeeId: 80,
      role: 'MANAGER',
      username: 'manager',
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 108,
      status: 'PENDING',
      leaveType: 'SICK_LEAVE',
      employeeId: 58,
      startDate: new Date('2026-04-07T00:00:00.000Z'),
      endDate: new Date('2026-04-07T00:00:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);
    mockPrisma.leaveRequest.update.mockResolvedValue({ id: 108 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [108],
        action: 'APPROVE',
        notes: '主管同意',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 108 },
        data: expect.objectContaining({
          status: 'PENDING_ADMIN',
          managerReviewerId: 80,
          managerOpinion: 'AGREE',
          managerNote: '主管同意',
        }),
      })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows admins to batch approve requests already forwarded to pending admin', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 101,
      status: 'PENDING_ADMIN',
      employee: {
        department: '財務部',
      },
    } as never);
    mockPrisma.leaveRequest.update.mockResolvedValue({ id: 101 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [101],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 101 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
  });

  it('accepts shared batch toolbar action names when admin approves leave requests', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 151,
      status: 'PENDING_ADMIN',
      employee: {
        department: '財務部',
      },
    } as never);
    mockPrisma.leaveRequest.update.mockResolvedValue({ id: 151 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [151],
        action: 'APPROVED',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 151 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
  });

  it('persists rejection notes from shared batch toolbar payloads for final shift exchange rejections', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 152,
      status: 'PENDING_ADMIN',
      requesterId: 11,
      targetEmployeeId: 12,
      originalWorkDate: '2026-04-05',
      targetWorkDate: '2026-04-06',
      requestReason: '調班',
      requester: {
        department: '財務部',
      },
    } as never);
    mockPrisma.shiftExchangeRequest.update.mockResolvedValue({ id: 152 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'SHIFT_EXCHANGE',
        ids: [152],
        action: 'REJECTED',
        remarks: '班表衝突',
        reason: '班表衝突',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.shiftExchangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 152 },
        data: expect.objectContaining({
          status: 'REJECTED',
          approvedBy: 10,
          adminRemarks: '班表衝突',
        }),
      })
    );
  });

  it('keeps supervisor leave approvals at pending admin instead of final approval', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 102,
      status: 'PENDING',
      leaveType: 'ANNUAL_LEAVE',
      employeeId: 55,
      startDate: new Date('2026-04-03T00:00:00.000Z'),
      endDate: new Date('2026-04-04T00:00:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);
    mockPrisma.leaveRequest.update.mockResolvedValue({ id: 102 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [102],
        action: 'APPROVE',
        notes: '同意，轉管理員',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 102 },
        data: expect.objectContaining({
          status: 'PENDING_ADMIN',
          managerReviewerId: 70,
          managerOpinion: 'AGREE',
          managerNote: '同意，轉管理員',
        }),
      })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.leaveRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.schedule.updateMany).not.toHaveBeenCalled();
  });

  it('blocks supervisors from final-approving leave requests that already reached pending admin', async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 103,
      status: 'PENDING_ADMIN',
      leaveType: 'ANNUAL_LEAVE',
      employeeId: 55,
      startDate: new Date('2026-04-10T00:00:00.000Z'),
      endDate: new Date('2026-04-10T00:00:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [103],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無權限進行最終決核');
    expect(payload.failedIds).toEqual([103]);
    expect(payload.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
    });
    expect(payload.results).toEqual([
      { id: 103, success: false, error: '無權限進行最終決核' },
    ]);
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.leaveRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.schedule.updateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before destructuring batch review payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: '{"resourceType":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects non-numeric ids before any batch review database operations run', async () => {
    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [100, 'oops'],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '申請編號格式無效' });
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns success even when audit logging fails after a successful approval', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 101,
      status: 'PENDING',
      employee: {
        department: '財務部',
      },
    } as never);
    mockPrisma.leaveRequest.update.mockResolvedValue({ id: 101 } as never);
    mockPrisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [101],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 101 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '批次審核審計日誌寫入失敗:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('wraps approved overtime comp-leave accrual in a transaction', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 202,
      status: 'PENDING',
      employeeId: 88,
      totalHours: 4,
      compensationType: 'COMP_LEAVE',
      overtimeDate: new Date('2026-03-31T16:30:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);
    transactionClient.overtimeRequest.update.mockResolvedValue({ id: 202 } as never);
    transactionClient.compLeaveTransaction.create.mockResolvedValue({ id: 1 } as never);
    transactionClient.compLeaveBalance.upsert.mockResolvedValue({ id: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'OVERTIME',
        ids: [202],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 202 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
    expect(transactionClient.compLeaveTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          yearMonth: '2026-04',
        }),
      })
    );
    expect(transactionClient.compLeaveBalance.upsert).toHaveBeenCalled();
  });

  it('keeps supervisor overtime approvals at pending admin before comp-leave accrual', async () => {
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 203,
      status: 'PENDING',
      employeeId: 88,
      totalHours: 4,
      compensationType: 'COMP_LEAVE',
      overtimeDate: new Date('2026-03-12T10:00:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 203 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'OVERTIME',
        ids: [203],
        action: 'APPROVE',
        notes: '同意，轉管理員',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 203 },
        data: expect.objectContaining({
          status: 'PENDING_ADMIN',
          managerReviewerId: 70,
          managerOpinion: 'AGREE',
          managerNote: '同意，轉管理員',
        }),
      })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.overtimeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.compLeaveTransaction.create).not.toHaveBeenCalled();
    expect(transactionClient.compLeaveBalance.upsert).not.toHaveBeenCalled();
  });

  it('blocks supervisors from final-approving overtime requests that already reached pending admin', async () => {
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 204,
      status: 'PENDING_ADMIN',
      employeeId: 88,
      totalHours: 4,
      compensationType: 'COMP_LEAVE',
      overtimeDate: new Date('2026-03-12T10:00:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'OVERTIME',
        ids: [204],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無權限進行最終決核');
    expect(payload.failedIds).toEqual([204]);
    expect(payload.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
    });
    expect(payload.results).toEqual([
      { id: 204, success: false, error: '無權限進行最終決核' },
    ]);
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.overtimeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.compLeaveTransaction.create).not.toHaveBeenCalled();
    expect(transactionClient.compLeaveBalance.upsert).not.toHaveBeenCalled();
  });

  it('wraps approved annual leave deduction and status update in a transaction', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 303,
      status: 'PENDING',
      employeeId: 55,
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-03-10T00:00:00.000Z'),
      endDate: new Date('2026-03-12T00:00:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 303 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);
    transactionClient.schedule.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [303],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 303 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
    expect(transactionClient.annualLeave.updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 55,
        year: 2026,
      },
      data: {
        usedDays: { increment: 3 },
        remainingDays: { decrement: 3 },
      },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(1, {
      where: { employeeId: 55, workDate: '2026-03-10' },
      data: { shiftType: 'FDL', startTime: '', endTime: '' },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(2, {
      where: { employeeId: 55, workDate: '2026-03-11' },
      data: { shiftType: 'FDL', startTime: '', endTime: '' },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(3, {
      where: { employeeId: 55, workDate: '2026-03-12' },
      data: { shiftType: 'FDL', startTime: '', endTime: '' },
    });
  });

  it('splits annual leave deductions across yearly balances when batch approval crosses a year boundary', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 304,
      status: 'PENDING',
      employeeId: 55,
      leaveType: 'ANNUAL_LEAVE',
      startDate: new Date('2026-12-31T00:00:00.000Z'),
      endDate: new Date('2027-01-02T00:00:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 304 } as never);
    transactionClient.annualLeave.updateMany.mockResolvedValue({ count: 1 } as never);
    transactionClient.schedule.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [304],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(transactionClient.annualLeave.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        employeeId: 55,
        year: 2026,
      },
      data: {
        usedDays: { increment: 1 },
        remainingDays: { decrement: 1 },
      },
    });
    expect(transactionClient.annualLeave.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        employeeId: 55,
        year: 2027,
      },
      data: {
        usedDays: { increment: 2 },
        remainingDays: { decrement: 2 },
      },
    });
  });

  it('updates schedules to FDL for approved non-annual leave batch requests', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 305,
      status: 'PENDING',
      employeeId: 55,
      leaveType: 'SICK_LEAVE',
      startDate: new Date('2026-04-08T00:00:00.000Z'),
      endDate: new Date('2026-04-09T00:00:00.000Z'),
      employee: {
        department: '製造部',
      },
    } as never);
    transactionClient.leaveRequest.update.mockResolvedValue({ id: 305 } as never);
    transactionClient.schedule.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'LEAVE',
        ids: [305],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 305 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
    expect(transactionClient.annualLeave.updateMany).not.toHaveBeenCalled();
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(1, {
      where: { employeeId: 55, workDate: '2026-04-08' },
      data: { shiftType: 'FDL', startTime: '', endTime: '' },
    });
    expect(transactionClient.schedule.updateMany).toHaveBeenNthCalledWith(2, {
      where: { employeeId: 55, workDate: '2026-04-09' },
      data: { shiftType: 'FDL', startTime: '', endTime: '' },
    });
  });

  it('swaps schedules transactionally when batch-approving shift exchange requests', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 404,
      status: 'PENDING',
      requesterId: 21,
      targetEmployeeId: 22,
      originalWorkDate: '2026-03-20',
      targetWorkDate: '2026-03-21',
      requester: {
        department: '製造部',
      },
    } as never);
    transactionClient.shiftExchangeRequest.update.mockResolvedValue({ id: 404 } as never);
    transactionClient.schedule.findFirst
      .mockResolvedValueOnce({ id: 9001, shiftType: 'A', startTime: '08:00', endTime: '16:00' } as never)
      .mockResolvedValueOnce({ id: 9002, shiftType: 'B', startTime: '16:00', endTime: '00:00' } as never);
    transactionClient.schedule.update.mockResolvedValue({ id: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'SHIFT_EXCHANGE',
        ids: [404],
        action: 'APPROVE',
        notes: '核准互調，請依備註執行',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.shiftExchangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 404 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
          adminRemarks: '核准互調，請依備註執行',
        }),
      })
    );
    expect(transactionClient.schedule.findFirst).toHaveBeenNthCalledWith(1, {
      where: { employeeId: 21, workDate: '2026-03-20' },
    });
    expect(transactionClient.schedule.findFirst).toHaveBeenNthCalledWith(2, {
      where: { employeeId: 22, workDate: '2026-03-21' },
    });
    expect(transactionClient.schedule.update).toHaveBeenNthCalledWith(1, {
      where: { id: 9001 },
      data: { shiftType: 'B', startTime: '16:00', endTime: '00:00' },
    });
    expect(transactionClient.schedule.update).toHaveBeenNthCalledWith(2, {
      where: { id: 9002 },
      data: { shiftType: 'A', startTime: '08:00', endTime: '16:00' },
    });
  });

  it('keeps supervisor shift exchange approvals at pending admin before schedule swaps', async () => {
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 405,
      status: 'PENDING',
      requesterId: 21,
      targetEmployeeId: 22,
      originalWorkDate: '2026-03-20',
      targetWorkDate: '2026-03-21',
      requester: {
        department: '製造部',
      },
    } as never);
    mockPrisma.shiftExchangeRequest.update.mockResolvedValue({ id: 405 } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'SHIFT_EXCHANGE',
        ids: [405],
        action: 'APPROVE',
        notes: '同意，轉管理員',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockPrisma.shiftExchangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 405 },
        data: expect.objectContaining({
          status: 'PENDING_ADMIN',
          managerReviewerId: 70,
          managerOpinion: 'AGREE',
          managerNote: '同意，轉管理員',
        }),
      })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.schedule.findFirst).not.toHaveBeenCalled();
    expect(transactionClient.schedule.update).not.toHaveBeenCalled();
  });

  it('blocks supervisors from final-rejecting shift exchange requests that already reached pending admin', async () => {
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 409,
      status: 'PENDING_ADMIN',
      requesterId: 21,
      targetEmployeeId: 22,
      originalWorkDate: '2026-03-20',
      targetWorkDate: '2026-03-21',
      requester: {
        department: '製造部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'SHIFT_EXCHANGE',
        ids: [409],
        action: 'REJECT',
        notes: '主管不可最終退回',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無權限進行最終決核');
    expect(payload.failedIds).toEqual([409]);
    expect(payload.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
    });
    expect(payload.results).toEqual([
      { id: 409, success: false, error: '無權限進行最終決核' },
    ]);
    expect(mockPrisma.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.schedule.findFirst).not.toHaveBeenCalled();
    expect(transactionClient.schedule.update).not.toHaveBeenCalled();
  });

  it('fails shift exchange approvals when the referenced schedules cannot be found', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 406,
      status: 'PENDING',
      requesterId: 21,
      targetEmployeeId: 22,
      originalWorkDate: '2026-03-20',
      targetWorkDate: '2026-03-21',
      requester: {
        department: '製造部',
      },
    } as never);
    transactionClient.schedule.findFirst
      .mockResolvedValueOnce({ id: 9001, shiftType: 'A', startTime: '08:00', endTime: '16:00' } as never)
      .mockResolvedValueOnce(null as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'SHIFT_EXCHANGE',
        ids: [406],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('找不到對應班表，無法核准調班申請');
    expect(payload.failedIds).toEqual([406]);
    expect(payload.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
    });
    expect(payload.results).toEqual([
      { id: 406, success: false, error: '找不到對應班表，無法核准調班申請' },
    ]);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.schedule.update).not.toHaveBeenCalled();
  });

  it('calculates overtime pay fields when batch-approving overtime pay requests', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 205,
      status: 'PENDING',
      employeeId: 66,
      overtimeDate: new Date('2026-03-16T00:00:00.000Z'),
      totalHours: 3,
      compensationType: 'OVERTIME_PAY',
      employee: {
        department: '製造部',
      },
    } as never);
    mockCalculateOvertimePayForRequest.mockResolvedValue({
      success: true,
      overtimePay: 1200,
      hourlyRate: 240,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'OVERTIME',
        ids: [205],
        action: 'APPROVE',
        overtimeType: 'REST_DAY',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({
      total: 1,
      success: 1,
      failed: 0,
    });
    expect(mockCalculateOvertimePayForRequest).toHaveBeenCalledWith(
      66,
      new Date('2026-03-16T00:00:00.000Z'),
      3,
      'REST_DAY'
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 205 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
          overtimeType: 'REST_DAY',
          overtimePay: 1200,
          hourlyRateUsed: 240,
        }),
      })
    );
  });

  it('marks overtime-pay requests as failed when overtime pay calculation fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 206,
      status: 'PENDING_ADMIN',
      employeeId: 67,
      overtimeDate: new Date('2026-03-17T00:00:00.000Z'),
      totalHours: 2,
      compensationType: 'OVERTIME_PAY',
      employee: {
        department: '製造部',
      },
    } as never);
    mockCalculateOvertimePayForRequest.mockResolvedValue({
      success: false,
      error: 'rate unavailable',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'OVERTIME',
        ids: [206],
        action: 'APPROVE',
        overtimeType: 'REST_DAY',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('加班費計算失敗：rate unavailable');
    expect(payload.failedIds).toEqual([206]);
    expect(payload.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
    });
    expect(payload.results).toEqual([
      { id: 206, success: false, error: '加班費計算失敗：rate unavailable' },
    ]);
    expect(mockCalculateOvertimePayForRequest).toHaveBeenCalledWith(
      67,
      new Date('2026-03-17T00:00:00.000Z'),
      2,
      'REST_DAY'
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('批次計算加班費失敗:', 'rate unavailable');

    consoleErrorSpy.mockRestore();
  });

  it('blocks batch shift exchange approvals when the original month is frozen', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 407,
      status: 'PENDING',
      requesterId: 21,
      targetEmployeeId: 22,
      originalWorkDate: '2026-03-20',
      targetWorkDate: '2026-03-21',
      requester: {
        department: '製造部',
      },
    } as never);
    mockCheckAttendanceFreeze.mockResolvedValueOnce({
      isFrozen: true,
      freezeInfo: {
        freezeDate: new Date('2026-03-31T12:34:56.000Z'),
        creator: { name: '系統管理員' },
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'SHIFT_EXCHANGE',
        ids: [407],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.failedIds).toEqual([407]);
    expect(payload.error).toEqual(expect.stringContaining('該月份已被凍結，無法核准調班申請'));
    expect(payload.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
    });
    expect(payload.results).toEqual([
      {
        id: 407,
        success: false,
        error: expect.stringContaining('該月份已被凍結，無法核准調班申請'),
      },
    ]);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.schedule.findFirst).not.toHaveBeenCalled();
  });

  it('blocks batch shift exchange approvals when the target month is frozen', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.shiftExchangeRequest.findUnique.mockResolvedValue({
      id: 408,
      status: 'PENDING',
      requesterId: 21,
      targetEmployeeId: 22,
      originalWorkDate: '2026-03-20',
      targetWorkDate: '2026-04-01',
      requester: {
        department: '製造部',
      },
    } as never);
    mockCheckAttendanceFreeze
      .mockResolvedValueOnce({ isFrozen: false } as never)
      .mockResolvedValueOnce({
        isFrozen: true,
        freezeInfo: {
          freezeDate: new Date('2026-04-30T09:00:00.000Z'),
          creator: { name: '排班主管' },
        },
      } as never);

    const request = new NextRequest('http://localhost:3000/api/batch-approve', {
      method: 'POST',
      headers: {
        cookie: 'auth-token=test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resourceType: 'SHIFT_EXCHANGE',
        ids: [408],
        action: 'APPROVE',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.failedIds).toEqual([408]);
    expect(payload.error).toEqual(expect.stringContaining('目標月份已被凍結，無法核准調班申請'));
    expect(payload.summary).toEqual({
      total: 1,
      success: 0,
      failed: 1,
    });
    expect(payload.results).toEqual([
      {
        id: 408,
        success: false,
        error: expect.stringContaining('目標月份已被凍結，無法核准調班申請'),
      },
    ]);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.shiftExchangeRequest.update).not.toHaveBeenCalled();
    expect(transactionClient.schedule.findFirst).not.toHaveBeenCalled();
  });
});