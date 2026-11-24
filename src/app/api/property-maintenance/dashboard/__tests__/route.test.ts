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
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/property-due-task-service', () => ({
  ensureImmediateMaintenanceTasks: jest.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const record = prisma.maintenanceRecord as unknown as { count: jest.Mock; findMany: jest.Mock };

// 台北 2026-11-15 11:00 → 今天 00:00 = 11/14 16:00Z，明天 00:00 = 11/15 16:00Z
const NOW = new Date('2026-11-15T03:00:00.000Z');
const TODAY = new Date('2026-11-14T16:00:00.000Z');
const TOMORROW = new Date('2026-11-15T16:00:00.000Z');

function get(query = '') {
  return GET(new NextRequest(`http://localhost/api/property-maintenance/dashboard${query}`));
}

// 路由先數 逾期／今日／本週完成，再對待辦清單數一次總筆數並查當頁資料
const TASK_COUNT_CALL = 3;

describe('property maintenance dashboard route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 1, employeeId: 1, username: 'maintainer', role: 'EMPLOYEE' },
        access: { isGlobalAdmin: false, siteIds: [1], supervisorSiteIds: [], roleBySite: new Map() },
      },
    } as never);
    record.count.mockResolvedValue(0);
    record.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['', { lt: TOMORROW }],
    ['?filter=all', { lt: TOMORROW }],
    ['?filter=overdue', { lt: TODAY }],
    ['?filter=today', { gte: TODAY, lt: TOMORROW }],
    ['?filter=nonsense', { lt: TOMORROW }],
  ])('依 %s 篩選待辦任務的到期日', async (query, expectedDueDate) => {
    const response = await get(query);

    expect(response.status).toBe(200);
    const listWhere = record.findMany.mock.calls[0][0].where;
    expect(listWhere).toMatchObject({ status: 'PENDING', dueDate: expectedDueDate });
    // 總筆數與清單必須用同一個條件，篩選後的筆數與頁數才會正確
    expect(record.count.mock.calls[TASK_COUNT_CALL][0].where).toEqual(listWhere);
  });

  it('依篩選後的筆數分頁', async () => {
    record.count.mockResolvedValue(60);

    const response = await get('?filter=overdue&page=3');
    const { data } = await response.json();

    expect(record.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 25 }));
    expect(data.pagination).toEqual({ total: 60, page: 3, pageSize: 25, pages: 3 });
  });

  it('任務帶出「據點代碼:財產編號」，兩個據點的同號資產才不會在開始維護時開錯或查不到', async () => {
    record.findMany.mockResolvedValue([
      {
        recordId: 'M-2026-11-14-A001~7',
        assetCode: 'A001',
        asset: { name: '輪椅', location: '1F' },
        site: { name: '溪北', code: 'XIBEI' },
        dueDate: TODAY,
        maintainerRaw: null,
        status: 'PENDING',
      },
      {
        recordId: 'M-2026-11-14-A001~8',
        assetCode: 'A001',
        asset: { name: '電動床', location: '2F' },
        site: { name: '西區', code: 'WEST' },
        dueDate: TODAY,
        maintainerRaw: null,
        status: 'PENDING',
      },
    ]);

    const { data } = await (await get()).json();

    expect(data.tasks.map((task: { scanCode: string }) => task.scanCode).sort()).toEqual(['WEST:A001', 'XIBEI:A001']);
    expect(record.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ site: { select: { name: true, code: true } } }),
      })
    );
  });

  it('摘要數字不受篩選影響', async () => {
    record.count.mockImplementation(({ where }: { where: { status: string; dueDate?: { lt?: Date; gte?: Date } } }) => {
      if (where.status === 'DONE') return Promise.resolve(23);
      if (where.dueDate?.gte) return Promise.resolve(0);
      return Promise.resolve(165);
    });

    const { data } = await (await get('?filter=today')).json();

    expect(data.summary).toEqual({ overdue: 165, today: 0, weekDone: 23 });
  });
});
