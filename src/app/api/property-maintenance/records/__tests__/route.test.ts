jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return { ...actual, guard: jest.fn() };
});

jest.mock('@/lib/database', () => ({
  prisma: {
    maintenanceRecord: { count: jest.fn(), findMany: jest.fn() },
  },
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const record = prisma.maintenanceRecord as unknown as { count: jest.Mock; findMany: jest.Mock };

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/property-maintenance/records${query}`));
}

describe('property maintenance record list (supervisor review queue)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 9, employeeId: 9, username: 'supervisor', role: 'EMPLOYEE' },
        access: {
          isGlobalAdmin: false,
          siteIds: [1],
          supervisorSiteIds: [1],
          roleBySite: new Map([[1, 'SUPERVISOR']]),
        },
      },
    } as never);
    record.count.mockResolvedValue(0);
    record.findMany.mockResolvedValue([]);
  });

  it('only lists submitted records as waiting for audit, not freshly generated tasks', async () => {
    await get('?audit=PENDING');

    const where = record.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ auditStatus: 'PENDING', siteId: { in: [1] } });
    // 新任務的 auditStatus 預設也是 PENDING，必須再要求「已提交」（狀態不是待執行）
    expect(where.AND).toEqual([{ status: { not: 'PENDING' } }]);
    // 筆數與清單用同一個條件
    expect(record.count.mock.calls[0][0].where).toEqual(where);
  });

  it('keeps the requested status filter independent from the review-queue condition', async () => {
    await get('?audit=PENDING&status=PENDING');

    const where = record.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PENDING');
    expect(where.AND).toEqual([{ status: { not: 'PENDING' } }]);
  });

  it.each(['APPROVED', 'REJECTED'])('does not add the submitted-only condition for %s history', async (audit) => {
    await get(`?audit=${audit}`);

    expect(record.findMany.mock.calls[0][0].where.AND).toBeUndefined();
  });

  it('does not touch the unfiltered list', async () => {
    await get('');

    expect(record.findMany.mock.calls[0][0].where.AND).toBeUndefined();
  });
});
