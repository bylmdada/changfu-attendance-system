jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return { ...actual, guard: jest.fn() };
});

jest.mock('@/lib/database', () => ({
  prisma: { propertyAsset: { findMany: jest.fn() } },
}));

jest.mock('@/lib/property-barcode', () => ({
  ...jest.requireActual('@/lib/property-barcode'),
  generateCode128DataUrl: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';
import { generateCode128DataUrl } from '@/lib/property-barcode';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const mockedGenerate = generateCode128DataUrl as jest.MockedFunction<typeof generateCode128DataUrl>;
const asset = prisma.propertyAsset as unknown as { findMany: jest.Mock };

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/property-maintenance/assets/labels', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

describe('property asset batch label route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 1, employeeId: 1, username: 'admin', role: 'ADMIN' },
        access: { isGlobalAdmin: true, siteIds: [], supervisorSiteIds: [], roleBySite: new Map() },
      },
    } as never);
    mockedGenerate.mockImplementation(async (text) => `data:image/png;base64,${Buffer.from(text).toString('base64')}`);
  });

  it('prints the site code in every barcode so same-numbered assets of two sites do not collide', async () => {
    asset.findMany.mockResolvedValue([
      { assetCode: 'A001', name: '輪椅', location: '1F', site: { code: 'XIBEI' } },
      { assetCode: 'A001', name: '電動床', location: '2F', site: { code: 'WEST' } },
    ]);

    const response = await post({ assetIds: [1, 2] });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(mockedGenerate.mock.calls.map(([text]) => text)).toEqual(['XIBEI:A001', 'WEST:A001']);
    expect(html).toContain('alt="XIBEI:A001"');
    expect(html).toContain('alt="WEST:A001"');
  });

  it('asks the database for the site code of each asset', async () => {
    asset.findMany.mockResolvedValue([]);

    await post({ siteId: 3 });

    expect(asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ site: { select: { code: true } } }),
      })
    );
  });

  it('flags assets whose site-qualified value cannot be encoded as CODE_128', async () => {
    asset.findMany.mockResolvedValue([
      { assetCode: '長福會輪椅', name: '輪椅', location: null, site: { code: 'XIBEI' } },
    ]);

    const html = await (await post({ assetIds: [1] })).text();

    expect(mockedGenerate).not.toHaveBeenCalled();
    expect(html).toContain('無法產生 CODE_128');
  });
});
