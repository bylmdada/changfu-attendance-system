jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return { ...actual, guard: jest.fn() };
});

jest.mock('@/lib/property-access', () => ({
  canManageSite: jest.fn(() => true),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    assetModificationRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    propertyAsset: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { PUT } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const mockedPrisma = prisma as unknown as {
  assetModificationRequest: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

function request() {
  return new NextRequest('http://localhost/api/property-maintenance/modification-requests/1', {
    method: 'PUT',
    body: JSON.stringify({ decision: 'APPROVE' }),
  });
}

describe('property modification approval guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 1, employeeId: 1, username: 'admin', role: 'ADMIN' },
        access: { isGlobalAdmin: true },
      },
    } as never);
  });

  it('rejects an unrecognized maintenance frequency', async () => {
    mockedPrisma.assetModificationRequest.findUnique.mockResolvedValue({
      id: 1,
      assetId: 8,
      field: 'maintenanceFrequency',
      originalValue: '每月一次',
      proposedValue: '每季一次左右',
      reviewStatus: 'PENDING',
      asset: {
        id: 8,
        siteId: 1,
        maintenanceFrequency: '每月一次',
        updatedAt: new Date(),
      },
    });

    const response = await PUT(request(), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(400);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects approval when the asset changed after the request was created', async () => {
    mockedPrisma.assetModificationRequest.findUnique.mockResolvedValue({
      id: 1,
      assetId: 8,
      field: 'location',
      originalValue: 'A',
      proposedValue: 'B',
      reviewStatus: 'PENDING',
      asset: {
        id: 8,
        siteId: 1,
        location: 'C',
        updatedAt: new Date(),
      },
    });

    const response = await PUT(request(), { params: Promise.resolve({ id: '1' }) });

    expect(response.status).toBe(409);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
