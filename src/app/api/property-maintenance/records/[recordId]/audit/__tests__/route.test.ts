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

function buildRequest() {
  return new NextRequest('http://localhost/api/property-maintenance/records/M-1/audit', {
    method: 'POST',
    body: JSON.stringify({ decision: 'APPROVE' }),
  });
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
      auditStatus: '待主管稽核',
      maintainerEmployeeId: 9,
    });

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ recordId: 'M-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('不可審核自己的紀錄');
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedPrisma.employee.findUnique).not.toHaveBeenCalled();
  });
});
