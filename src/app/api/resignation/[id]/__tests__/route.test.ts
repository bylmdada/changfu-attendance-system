import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { DELETE, GET, PUT } from '@/app/api/resignation/[id]/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getApprovalWorkflow } from '@/lib/approval-workflow';

jest.mock('@/lib/database', () => ({
  prisma: {
    resignationRecord: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      updateMany: jest.fn(),
    },
    handoverItem: {
      count: jest.fn(),
    },
    approvalInstance: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    approvalReview: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn(),
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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockGetApprovalWorkflow = getApprovalWorkflow as jest.MockedFunction<typeof getApprovalWorkflow>;

describe('resignation detail route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.handoverItem.count.mockResolvedValue(0 as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      resignationRecord: mockPrisma.resignationRecord,
      employee: mockPrisma.employee,
      user: mockPrisma.user,
      approvalInstance: mockPrisma.approvalInstance,
      approvalReview: mockPrisma.approvalReview,
    } as never) as never);
    mockPrisma.resignationRecord.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'APPROVED',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: 'Test User',
        department: 'HR',
        position: 'Manager',
        hireDate: new Date('2020-01-01'),
      },
      handoverItems: [],
    } as never);
  });

  it('returns 400 when route id is not a strict positive integer on GET', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5abc');

    const response = await GET(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('離職申請ID格式無效');
    expect(mockPrisma.resignationRecord.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when PUT body JSON is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"action":"approve"',
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.resignationRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.resignationRecord.update).not.toHaveBeenCalled();
  });

  it('returns 400 when complete action uses an invalid actualDate', async () => {
    mockPrisma.resignationRecord.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'IN_HANDOVER',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'complete',
        actualDate: 'not-a-date',
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('實際離職日格式無效');
    expect(mockPrisma.resignationRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.employee.update).not.toHaveBeenCalled();
  });

  it('returns 400 when an admin tries to approve a non-pending resignation', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'approve',
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('只有待審核的申請可以核准，目前狀態為 APPROVED');
    expect(mockPrisma.resignationRecord.update).not.toHaveBeenCalled();
  });

  it('returns 400 when complete action still has unfinished handover items', async () => {
    mockPrisma.resignationRecord.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'IN_HANDOVER',
    } as never);
    mockPrisma.handoverItem.count.mockResolvedValue(2 as never);

    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'complete',
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('尚有未完成的交接項目，無法完成離職');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('completes resignation atomically and disables both employee and login account', async () => {
    mockPrisma.resignationRecord.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'IN_HANDOVER',
    } as never);
    mockPrisma.resignationRecord.update.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'COMPLETED',
      employee: {
        id: 10,
        employeeId: 'E010',
        name: 'Test User',
      }
    } as never);
    mockPrisma.employee.update.mockResolvedValue({ id: 10, isActive: false } as never);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation/5', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'complete',
        actualDate: '2026-05-01',
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toBe('離職流程已完成，員工與登入帳號已停用');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.employee.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { isActive: false }
    });
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 10 },
      data: {
        isActive: false,
        currentSessionId: null
      }
    });
  });

  it('returns 400 when route id is not a strict positive integer on DELETE', async () => {
    const request = new NextRequest('http://localhost:3000/api/resignation/5abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('離職申請ID格式無效');
    expect(mockPrisma.resignationRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.resignationRecord.delete).not.toHaveBeenCalled();
  });
  describe('核准／駁回同步保存審核歷程', () => {
    const decide = (body: Record<string, unknown>) =>
      PUT(
        new NextRequest('http://localhost:3000/api/resignation/5', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: '5' }) }
      );

    beforeEach(() => {
      mockPrisma.resignationRecord.findUnique.mockResolvedValue({ id: 5, employeeId: 10, status: 'PENDING' } as never);
      mockPrisma.employee.findUnique
        .mockResolvedValueOnce({ id: 10, name: '王小明', department: '照護部' } as never) // 申請人
        .mockResolvedValueOnce({ name: '人資甲' } as never); // 審核人
      mockGetApprovalWorkflow.mockResolvedValue({ approvalLevel: 2, requireManager: true } as never);
      mockPrisma.resignationRecord.updateMany.mockResolvedValue({ count: 1 } as never);
      mockPrisma.resignationRecord.findUniqueOrThrow.mockResolvedValue({ id: 5, status: 'APPROVED', employee: { id: 10 } } as never);
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null as never);
      mockPrisma.approvalInstance.create.mockResolvedValue({ id: 70 } as never);
      mockPrisma.approvalReview.create.mockResolvedValue({ id: 1 } as never);
    });

    it('approving writes the decision and its history in one transaction', async () => {
      const response = await decide({ action: 'approve', notes: '請完成交接' });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.message).toBe('離職申請已核准');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // 只有仍待審的單能被改
      expect(mockPrisma.resignationRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 5, status: 'PENDING' },
        data: expect.objectContaining({ status: 'APPROVED', approvedById: 1, notes: '請完成交接' }),
      });
      expect(mockPrisma.approvalInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestType: 'RESIGNATION',
          requestId: 5,
          applicantId: 10,
          applicantName: '王小明',
          department: '照護部',
          status: 'APPROVED',
          currentLevel: 2,
          maxLevel: 2,
        }),
      });
      expect(mockPrisma.approvalReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          instanceId: 70,
          level: 2,
          reviewerId: 10,
          reviewerName: '人資甲',
          reviewerRole: 'ADMIN',
          action: 'APPROVE',
          comment: '請完成交接',
        }),
      });
    });

    it('rejecting writes a REJECTED history entry carrying the rejection reason', async () => {
      const response = await decide({ action: 'reject', rejectionReason: '交接期不足' });

      expect(response.status).toBe(200);
      expect(mockPrisma.resignationRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 5, status: 'PENDING' },
        data: expect.objectContaining({ status: 'REJECTED', rejectionReason: '交接期不足' }),
      });
      expect(mockPrisma.approvalInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'REJECTED' }),
      });
      expect(mockPrisma.approvalReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'REJECT', comment: '交接期不足' }),
      });
    });

    it('answers 409 and writes no history when another reviewer already decided', async () => {
      mockPrisma.resignationRecord.updateMany.mockResolvedValue({ count: 0 } as never);

      const response = await decide({ action: 'approve' });
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload.error).toContain('已被處理');
      expect(mockPrisma.approvalInstance.create).not.toHaveBeenCalled();
      expect(mockPrisma.approvalReview.create).not.toHaveBeenCalled();
    });
  });
});
