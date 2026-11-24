jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return { ...actual, guard: jest.fn() };
});

jest.mock('@/lib/database', () => ({
  prisma: {
    maintenanceRecord: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn() },
    auditApproval: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/property-cron-service', () => ({
  notifySupervisorsOfSubmission: jest.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from 'next/server';
import { GET, PUT } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const db = prisma as unknown as {
  maintenanceRecord: { findUnique: jest.Mock };
  employee: { findUnique: jest.Mock };
  auditApproval: { findMany: jest.Mock };
  $transaction: jest.Mock;
};

const pendingRecord = {
  id: 1,
  recordId: 'M-2026-11-23-A001~7',
  siteId: 1,
  assetCode: 'A001',
  status: 'PENDING',
  note: null,
  photoPath: null,
  signaturePath: null,
  maintainerRaw: null,
  maintainerEmployeeId: null,
  asset: { id: 7, name: '輪椅', location: '1F', maintenanceFrequency: '每月一次', frequencyDays: 28 },
  attachments: [],
};

function params(recordId = pendingRecord.recordId) {
  return { params: Promise.resolve({ recordId: encodeURIComponent(recordId) }) };
}

function put(body: Record<string, unknown>) {
  return PUT(
    new NextRequest('http://localhost/api/property-maintenance/records/x', { method: 'PUT', body: JSON.stringify(body) }),
    params()
  );
}

function mockTransaction() {
  const tx = {
    maintenanceRecord: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...pendingRecord, status: 'DONE' }),
    },
    propertyAsset: { update: jest.fn().mockResolvedValue({}) },
    auditApproval: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  return tx;
}

describe('property maintenance record route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 5, employeeId: 5, username: 'maintainer', role: 'EMPLOYEE' },
        access: { isGlobalAdmin: false, siteIds: [1], supervisorSiteIds: [], roleBySite: new Map([[1, 'MAINTAINER']]) },
      },
    } as never);
    db.maintenanceRecord.findUnique.mockResolvedValue({ ...pendingRecord });
    db.employee.findUnique.mockResolvedValue({ id: 5, name: '王小明' });
  });

  describe('PUT (submit maintenance)', () => {
    it('records 有異常 as the status text for an abnormal scan submission, not the default 已完成', async () => {
      const tx = mockTransaction();

      const response = await put({
        conditionAssessment: {
          status: 'ABNORMAL',
          abnormalConditionItems: ['輔具結構'],
          abnormalDescription: '支架鬆脫',
        },
      });

      expect(response.status).toBe(200);
      const data = tx.maintenanceRecord.updateMany.mock.calls[0][0].data;
      expect(data).toMatchObject({
        status: 'ABNORMAL',
        rawStatus: '有異常',
        conditionAssessmentStatus: 'ABNORMAL',
        abnormalDescription: '支架鬆脫',
        auditStatus: 'PENDING',
        rejectReason: null,
      });
      expect(tx.auditApproval.create).toHaveBeenCalledTimes(1);
    });

    it('records 無異常 for a normal scan submission', async () => {
      const tx = mockTransaction();

      await put({
        conditionAssessment: { status: 'NO_ABNORMALITY', normalConditionItems: ['輔具配件完整'] },
      });

      expect(tx.maintenanceRecord.updateMany.mock.calls[0][0].data).toMatchObject({
        status: 'DONE',
        rawStatus: '無異常',
        conditionAssessmentStatus: 'NO_ABNORMALITY',
      });
    });

    it.each([
      [{ status: '異常' }, 'ABNORMAL', '異常'],
      [{}, 'DONE', '已完成'],
    ])('keeps the legacy form behaviour for %j', async (body, expectedStatus, expectedRaw) => {
      const tx = mockTransaction();

      await put(body);

      expect(tx.maintenanceRecord.updateMany.mock.calls[0][0].data).toMatchObject({
        status: expectedStatus,
        rawStatus: expectedRaw,
        conditionAssessmentStatus: null,
      });
    });
  });

  describe('GET (record detail)', () => {
    it('returns every audit round so earlier rejection reasons stay readable after resubmission', async () => {
      const rounds = [
        { id: 1, submittedAt: new Date('2026-11-01T00:00:00Z'), auditStatus: 'REJECTED', supervisorName: '甲主管', supervisorAuditDate: new Date('2026-11-02T00:00:00Z'), note: '照片不清楚' },
        { id: 2, submittedAt: new Date('2026-11-03T00:00:00Z'), auditStatus: 'PENDING', supervisorName: null, supervisorAuditDate: null, note: null },
      ];
      db.auditApproval.findMany.mockResolvedValue(rounds);

      const response = await GET(
        new NextRequest('http://localhost/api/property-maintenance/records/x'),
        params()
      );
      const { data } = await response.json();

      expect(response.status).toBe(200);
      expect(db.auditApproval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { recordId: pendingRecord.recordId }, orderBy: { createdAt: 'asc' } })
      );
      expect(data.auditRounds).toHaveLength(2);
      expect(data.auditRounds[0]).toMatchObject({ auditStatus: 'REJECTED', supervisorName: '甲主管', note: '照片不清楚' });
      expect(data.attachments).toEqual([]);
    });
  });
});
