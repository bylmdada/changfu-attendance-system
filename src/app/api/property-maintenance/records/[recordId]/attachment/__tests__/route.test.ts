jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
}));

jest.mock('@/lib/property-api', () => {
  const actual = jest.requireActual('@/lib/property-api');
  return {
    ...actual,
    guard: jest.fn(),
  };
});

jest.mock('@/lib/property-access', () => ({
  canAccessSite: jest.fn(() => true),
  canMaintainSite: jest.fn(() => true),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    maintenanceRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { mkdir, writeFile } from 'fs/promises';
import { NextRequest } from 'next/server';
import { guard } from '@/lib/property-api';
import { prisma } from '@/lib/database';
import { POST } from '../route';

const mockedGuard = guard as jest.MockedFunction<typeof guard>;
const mockedPrisma = prisma as unknown as {
  maintenanceRecord: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};
const mockedMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockedWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

function buildUploadRequest(file: File, field = 'photo') {
  const form = new FormData();
  form.set('file', file);
  form.set('field', field);

  return new NextRequest('http://localhost/api/property-maintenance/records/M-1/attachment', {
    method: 'POST',
    body: form,
  });
}

function mockPendingRecord(siteCode = 'SITE1') {
  mockedPrisma.maintenanceRecord.findUnique.mockResolvedValue({
    recordId: 'M-1',
    status: 'PENDING',
    siteId: 1,
    site: { code: siteCode },
  });
}

describe('property maintenance photo/signature attachment route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuard.mockResolvedValue({
      ctx: {
        user: { userId: 10, employeeId: 9, username: 'maintainer', role: 'EMPLOYEE' },
        access: {
          isGlobalAdmin: false,
          siteIds: [1],
          supervisorSiteIds: [],
          roleBySite: new Map([[1, 'MAINTAINER']]),
        },
      },
    } as never);
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
    mockedPrisma.maintenanceRecord.update.mockResolvedValue({ recordId: 'M-1' });
  });

  it('rejects files whose declared image MIME does not match image bytes', async () => {
    mockPendingRecord();
    const file = new File([Buffer.from('MZ fake exe')], 'fake.jpg', { type: 'image/jpeg' });

    const response = await POST(buildUploadRequest(file), {
      params: Promise.resolve({ recordId: 'M-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('僅支援 JPG/PNG/WebP');
    expect(mockedMkdir).not.toHaveBeenCalled();
    expect(mockedWriteFile).not.toHaveBeenCalled();
    expect(mockedPrisma.maintenanceRecord.update).not.toHaveBeenCalled();
  });

  it('sanitizes site codes before writing uploaded files', async () => {
    mockPendingRecord('../evil site');
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const file = new File([pngBytes], 'photo.png', { type: 'image/png' });

    const response = await POST(buildUploadRequest(file), {
      params: Promise.resolve({ recordId: 'M-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.path).toContain('uploads/property-maintenance/evilsite/');
    expect(payload.data.path).not.toContain('..');
    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('/uploads/property-maintenance/evilsite/'),
      pngBytes
    );
    expect(mockedPrisma.maintenanceRecord.update).toHaveBeenCalledWith({
      where: { recordId: 'M-1' },
      data: { photoPath: expect.stringContaining('uploads/property-maintenance/evilsite/') },
    });
  });
});
