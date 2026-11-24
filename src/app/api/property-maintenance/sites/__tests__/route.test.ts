jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return { ...actual, guard: jest.fn() };
});

jest.mock('@/lib/database', () => ({
  prisma: { propertySite: { findMany: jest.fn() } },
}));

import { NextRequest } from 'next/server';
import { GET } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const site = prisma.propertySite as unknown as { findMany: jest.Mock };

const SITES = [
  { id: 1, name: '溪北', code: 'XIBEI', institutionTitle: 'x', evidenceTitle: 'x', settings: null, isActive: true, _count: { assets: 5 } },
  { id: 2, name: '西區', code: 'WEST', institutionTitle: 'x', evidenceTitle: 'x', settings: null, isActive: true, _count: { assets: 3 } },
];

function asUser(access: { isGlobalAdmin: boolean; siteIds: number[]; supervisorSiteIds: number[]; roleBySite: Map<number, string> }) {
  mockedGuard.mockResolvedValue({
    ctx: { user: { userId: 1, employeeId: 1, username: 'u', role: 'EMPLOYEE' }, access },
  } as never);
}

async function listSites() {
  const response = await GET(new NextRequest('http://localhost/api/property-maintenance/sites'));
  return (await response.json()).data as Array<{ id: number; canSupervise: boolean }>;
}

describe('property sites route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    site.findMany.mockResolvedValue(SITES);
  });

  it('marks every site as supervisable for a global admin', async () => {
    asUser({ isGlobalAdmin: true, siteIds: [], supervisorSiteIds: [], roleBySite: new Map() });

    expect((await listSites()).map((s) => [s.id, s.canSupervise])).toEqual([[1, true], [2, true]]);
  });

  it('marks only the sites where the user is a supervisor or auditor (a maintainer at one site, supervisor at another)', async () => {
    // 一人兼任 A 站（溪北）主管、B 站（西區）維護員：報表只能匯出 A 站
    asUser({
      isGlobalAdmin: false,
      siteIds: [1, 2],
      supervisorSiteIds: [1],
      roleBySite: new Map([[1, 'SUPERVISOR'], [2, 'MAINTAINER']]),
    });

    expect((await listSites()).map((s) => [s.id, s.canSupervise])).toEqual([[1, true], [2, false]]);
  });

  it('marks nothing as supervisable for a plain maintainer', async () => {
    asUser({ isGlobalAdmin: false, siteIds: [1], supervisorSiteIds: [], roleBySite: new Map([[1, 'MAINTAINER']]) });

    expect((await listSites()).every((s) => s.canSupervise === false)).toBe(true);
  });
});
