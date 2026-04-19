import { NextRequest } from 'next/server';
import { DELETE, GET, PUT } from '@/app/api/payroll-disputes/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    payrollDispute: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    payrollRecord: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    payrollAdjustment: {
      create: jest.fn(),
    },
    approvalInstance: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    approvalReview: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('payroll dispute item route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'HR',
      username: 'reviewer',
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.payrollDispute.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING',
      payYear: 2026,
      payMonth: 4,
      type: 'OVERTIME_MISSING',
      employee: { id: 10, name: '測試員工' },
    } as never);
    mockPrisma.payrollDispute.update.mockResolvedValue({ id: 5 } as never);
    mockPrisma.payrollDispute.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.payrollDispute.delete.mockResolvedValue({ id: 5 } as never);
    mockPrisma.payrollRecord.findFirst.mockResolvedValue({ id: 9 } as never);
    mockPrisma.payrollRecord.update.mockResolvedValue({ id: 9 } as never);
    mockPrisma.payrollAdjustment.create.mockResolvedValue({ id: 3 } as never);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue({
      id: 77,
      currentLevel: 2,
      maxLevel: 2,
      status: 'LEVEL2_REVIEWING',
    } as never);
    mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.approvalReview.create.mockResolvedValue({ id: 12 } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma as never) as never);
  });

  it('returns 400 on GET when path id is malformed', async () => {
    const response = await GET(new NextRequest('http://localhost/api/payroll-disputes/abc'), {
      params: Promise.resolve({ id: 'abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('記錄ID 格式錯誤');
  });

  it('returns 400 on PUT when body is null', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/payroll-disputes/5', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    }), {
      params: Promise.resolve({ id: '5' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的審核資料');
  });

  it('returns 400 on PUT when body contains malformed JSON', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/payroll-disputes/5', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"action":',
    }), {
      params: Promise.resolve({ id: '5' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.payrollDispute.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 on PUT when path id is malformed', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/payroll-disputes/abc', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reviewNote: 'nope' }),
    }), {
      params: Promise.resolve({ id: 'abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('記錄ID 格式錯誤');
  });

  it('returns 400 on PUT approve when adjustedAmount is malformed', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/payroll-disputes/5', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        adjustedAmount: 'abc',
        adjustInYear: 2026,
        adjustInMonth: 5,
      }),
    }), {
      params: Promise.resolve({ id: '5' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('adjustedAmount 格式錯誤');
  });

  it('returns 400 on PUT approve when adjustInYear is malformed', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/payroll-disputes/5', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        adjustedAmount: '1000',
        adjustInYear: '20xx',
        adjustInMonth: 5,
      }),
    }), {
      params: Promise.resolve({ id: '5' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('adjustInYear 格式錯誤');
  });

  it('applies deduction approvals to total deductions and syncs approval history', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/payroll-disputes/5', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        adjustedAmount: -500,
        adjustInYear: 2026,
        adjustInMonth: 5,
        reviewNote: '扣回溢發金額',
      }),
    }), {
      params: Promise.resolve({ id: '5' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toContain('計入 2026年5月薪資');
    expect(mockPrisma.payrollDispute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 5,
        status: 'PENDING',
      }),
      data: expect.objectContaining({
        status: 'APPROVED',
        adjustedAmount: -500,
        adjustInYear: 2026,
        adjustInMonth: 5,
        reviewNote: '扣回溢發金額',
      }),
    }));
    expect(mockPrisma.payrollAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payrollId: 9,
        disputeId: 5,
        type: 'DEDUCTION',
        amount: 500,
      }),
    });
    expect(mockPrisma.payrollRecord.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        grossPay: { increment: 0 },
        totalDeductions: { increment: 500 },
        netPay: { increment: -500 },
      },
    });
    expect(mockPrisma.approvalReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instanceId: 77,
        action: 'APPROVE',
        reviewerId: 10,
      }),
    });
    expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 77 }),
      data: {
        status: 'APPROVED',
        currentLevel: 2,
      },
    }));
  });

  it('leaves approved disputes for future payroll generation when target payroll is missing', async () => {
    mockPrisma.payrollRecord.findFirst.mockResolvedValueOnce(null as never);

    const response = await PUT(new NextRequest('http://localhost/api/payroll-disputes/5', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        adjustedAmount: 1200,
        adjustInYear: 2026,
        adjustInMonth: 6,
      }),
    }), {
      params: Promise.resolve({ id: '5' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toContain('待 2026年6月薪資產生時自動計入');
    expect(mockPrisma.payrollAdjustment.create).not.toHaveBeenCalled();
    expect(mockPrisma.payrollRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.payrollDispute.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'APPROVED',
        adjustedAmount: 1200,
      }),
    }));
  });

  it('returns 400 on DELETE when path id is malformed', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/payroll-disputes/abc', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'abc' }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('記錄ID 格式錯誤');
  });
});
