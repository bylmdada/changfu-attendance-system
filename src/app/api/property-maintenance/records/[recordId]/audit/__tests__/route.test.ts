jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return {
    ...actual,
    guard: jest.fn(),
  };
});

jest.mock('@/lib/database', () => ({
  prisma: {
    maintenanceRecord: {
      findUnique: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
    auditApproval: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const mockedPrisma = prisma as unknown as {
  maintenanceRecord: {
    findUnique: jest.Mock;
  };
  employee: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
};

function buildRequest(body: Record<string, unknown> = { decision: 'APPROVE' }) {
  return new NextRequest('http://localhost/api/property-maintenance/records/M-1/audit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const submittedRecord = {
  recordId: 'M-1',
  siteId: 1,
  assetCode: 'A-001',
  status: 'DONE',
  auditStatus: 'PENDING',
  maintainerEmployeeId: 5,
  maintainerRaw: '維護員',
  completedDate: new Date('2026-11-10T01:00:00.000Z'),
  updatedAt: new Date('2026-11-10T02:00:00.000Z'),
};

function mockTransaction(options: { pendingRound?: { id: number } | null } = {}) {
  const tx = {
    maintenanceRecord: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...submittedRecord }),
    },
    auditApproval: {
      findFirst: jest.fn().mockResolvedValue(options.pendingRound === undefined ? { id: 77 } : options.pendingRound),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  mockedPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  return tx;
}

describe('property maintenance audit route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 10, employeeId: 9, username: 'supervisor', role: 'EMPLOYEE' },
        access: {
          isGlobalAdmin: false,
          siteIds: [1],
          supervisorSiteIds: [1],
          roleBySite: new Map([[1, 'SUPERVISOR']]),
        },
      },
    } as never);
  });

  it('rejects self-audit when the reviewer submitted the maintenance record', async () => {
    mockedPrisma.maintenanceRecord.findUnique.mockResolvedValue({
      recordId: 'M-1',
      siteId: 1,
      assetCode: 'A-001',
      auditStatus: 'PENDING',
      maintainerEmployeeId: 9,
    });
    mockedPrisma.employee.findUnique.mockResolvedValue({ name: '維護主管' });

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ recordId: 'M-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('不可審核自己的紀錄');
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects self-audit when only the maintainer name can be resolved', async () => {
    mockedPrisma.maintenanceRecord.findUnique.mockResolvedValue({
      recordId: 'M-1',
      siteId: 1,
      assetCode: 'A-001',
      auditStatus: 'PENDING',
      maintainerEmployeeId: null,
      maintainerRaw: '維護主管',
    });
    mockedPrisma.employee.findUnique.mockResolvedValue({ name: '維護主管' });

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ recordId: 'M-1' }),
    });

    expect(response.status).toBe(403);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  describe('audit decisions', () => {
    beforeEach(() => {
      mockedPrisma.employee.findUnique.mockResolvedValue({ name: '稽核主管' });
    });

    it('refuses a task that has not been submitted yet, with a clear reason', async () => {
      mockedPrisma.maintenanceRecord.findUnique.mockResolvedValue({
        ...submittedRecord,
        status: 'PENDING', // 新產生的任務：auditStatus 預設也是 PENDING，但還沒提交
      });

      const response = await POST(buildRequest(), { params: Promise.resolve({ recordId: 'M-1' }) });
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload.error).toContain('尚未提交');
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('stores the rejection reason on the audit round and only decides submitted records', async () => {
      mockedPrisma.maintenanceRecord.findUnique.mockResolvedValue({ ...submittedRecord });
      const tx = mockTransaction();

      const response = await POST(buildRequest({ decision: 'REJECT', rejectReason: '  照片不清楚  ' }), {
        params: Promise.resolve({ recordId: 'M-1' }),
      });

      expect(response.status).toBe(200);
      expect(tx.auditApproval.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: expect.objectContaining({
          auditStatus: 'REJECTED',
          supervisorName: '稽核主管',
          note: '照片不清楚',
        }),
      });
      expect(tx.maintenanceRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ auditStatus: 'PENDING', status: { not: 'PENDING' } }),
          data: expect.objectContaining({ auditStatus: 'REJECTED', rejectReason: '照片不清楚', status: 'PENDING' }),
        })
      );
    });

    it('requires a reason for a rejection', async () => {
      mockedPrisma.maintenanceRecord.findUnique.mockResolvedValue({ ...submittedRecord });

      const response = await POST(buildRequest({ decision: 'REJECT', rejectReason: '   ' }), {
        params: Promise.resolve({ recordId: 'M-1' }),
      });

      expect(response.status).toBe(400);
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('backfills a decided round for an imported submission that never had one', async () => {
      mockedPrisma.maintenanceRecord.findUnique.mockResolvedValue({ ...submittedRecord });
      const tx = mockTransaction({ pendingRound: null });

      const response = await POST(buildRequest(), { params: Promise.resolve({ recordId: 'M-1' }) });

      expect(response.status).toBe(200);
      expect(tx.auditApproval.update).not.toHaveBeenCalled();
      expect(tx.auditApproval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recordId: 'M-1',
          assetCode: 'A-001',
          submittedAt: submittedRecord.completedDate,
          auditStatus: 'APPROVED',
          supervisorName: '稽核主管',
        }),
      });
    });
  });
});
