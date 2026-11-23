jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return { ...actual, guard: jest.fn() };
});

jest.mock('@/lib/database', () => ({
  prisma: { propertyAsset: { findUnique: jest.fn() } },
}));

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn() },
}));

import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { GET } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const mockedToDataURL = QRCode.toDataURL as unknown as jest.Mock;
const asset = prisma.propertyAsset as unknown as { findUnique: jest.Mock };

function get(id: number) {
  return GET(new NextRequest(`http://localhost/api/property-maintenance/assets/${id}/qr`), {
    params: Promise.resolve({ id: String(id) }),
  });
}

describe('property asset QR route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 1, employeeId: 1, username: 'u', role: 'EMPLOYEE' },
        access: { isGlobalAdmin: false, siteIds: [1, 2], supervisorSiteIds: [], roleBySite: new Map() },
      },
    } as never);
    mockedToDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  it.each([
    [1, 'XIBEI'],
    [2, 'WEST'],
  ])('encodes the site code so same-numbered assets of site %i stay distinguishable', async (siteId, siteCode) => {
    asset.findUnique.mockResolvedValue({
      id: 10 + siteId,
      siteId,
      assetCode: 'A001',
      name: '輪椅',
      site: { code: siteCode },
    });

    const response = await get(10 + siteId);
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(mockedToDataURL).toHaveBeenCalledWith(`${siteCode}:A001`, expect.any(Object));
    expect(data).toMatchObject({ assetCode: 'A001', dataUrl: 'data:image/png;base64,QR' });
  });
});
