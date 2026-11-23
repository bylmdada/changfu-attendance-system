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

describe('property maintenance stats route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 1, employeeId: 1, username: 'u', role: 'EMPLOYEE' },
        access: { isGlobalAdmin: false, siteIds: [1], supervisorSiteIds: [1], roleBySite: new Map() },
      },
    } as never);
  });

  it('counts a submitted abnormal task as not completed (business rule)', async () => {
    // 10 筆：6 已完成、2 異常、2 待執行
    record.count.mockImplementation(async ({ where }: { where: { status?: string; dueDate?: unknown; completedDate?: unknown } }) => {
      if (where.dueDate || where.completedDate) return 0; // 趨勢查詢
      if (where.status === 'DONE') return 6;
      if (where.status === 'ABNORMAL') return 2;
      return 10;
    });
    record.findMany.mockResolvedValue([{ dueDate: null }, { dueDate: null }]);

    const response = await GET(new NextRequest('http://localhost/api/property-maintenance/stats?months=1'));
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary).toMatchObject({ total: 10, done: 6, abnormal: 2, pending: 2 });
    // 完成率 = 已完成 ÷ 全部 = 60%，異常件不算完成（不是 80%）
    expect(data.summary.completionRate).toBe(60);
  });
});
