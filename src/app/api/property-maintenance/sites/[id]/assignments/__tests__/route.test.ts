jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return {
    ...actual,
    guard: jest.fn(),
  };
});

jest.mock('@/lib/database', () => ({
  prisma: {
    propertySite: {
      findUnique: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    userSiteAssignment: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const mockedPrisma = prisma as unknown as {
  propertySite: { findUnique: jest.Mock };
  employee: { findMany: jest.Mock };
  user: { findUnique: jest.Mock };
  userSiteAssignment: {
    findMany: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
};

describe('property maintenance site assignments route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 10, employeeId: 9, username: 'site-admin', role: 'EMPLOYEE' },
        access: {
          isGlobalAdmin: false,
          siteIds: [7],
          supervisorSiteIds: [7],
          roleBySite: new Map([[7, 'ADMIN']]),
        },
      },
    } as never);
    mockedPrisma.propertySite.findUnique.mockResolvedValue({
      id: 7,
      isActive: true,
    });
  });

  it('lists only active assignments for the selected site', async () => {
    mockedPrisma.userSiteAssignment.findMany.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('http://localhost/api/property-maintenance/sites/7/assignments'),
      { params: Promise.resolve({ id: '7' }) }
    );

    expect(response.status).toBe(200);
    expect(mockedPrisma.userSiteAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { siteId: 7, isActive: true },
      })
    );
  });

  it('rejects manual assignments for accounts not linked to active employees', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 22,
      username: 'huang',
      isActive: true,
      employee: {
        id: 11,
        name: '測試乙',
        employeeId: '2026990002',
        isActive: false,
      },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/property-maintenance/sites/7/assignments', {
        method: 'POST',
        body: JSON.stringify({ username: 'huang', maintenanceRole: 'SUPERVISOR' }),
      }),
      { params: Promise.resolve({ id: '7' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('未綁定在職員工');
    expect(mockedPrisma.userSiteAssignment.upsert).not.toHaveBeenCalled();
  });
});
