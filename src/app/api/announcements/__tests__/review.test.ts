import { NextRequest } from 'next/server';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(async () => Buffer.from('attachment-content')),
  unlink: jest.fn(async () => undefined),
  mkdir: jest.fn(async () => undefined),
  writeFile: jest.fn(async () => undefined),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
    },
    announcement: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    announcementAttachment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    },
    $executeRaw: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(async () => ({ valid: true })),
}));

jest.mock('@/lib/realtime-notifications', () => ({
  sendNotification: jest.fn(async () => undefined),
}));

jest.mock('@/lib/security', () => ({
  SecurityEventType: {
    CREATE_ANNOUNCEMENT: 'CREATE_ANNOUNCEMENT',
  },
  logSecurityEvent: jest.fn(async () => undefined),
}));

jest.mock('@/lib/upload-validation', () => ({
  validateAttachmentFile: jest.fn(() => ({ valid: true })),
  validateFiles: jest.fn(() => ({ valid: true, errors: [] })),
  FILE_SIZE_LIMITS: {
    ATTACHMENT: 10 * 1024 * 1024,
    TOTAL_UPLOAD: 50 * 1024 * 1024,
  },
  ALLOWED_MIME_TYPES: {
    ALL: ['text/plain', 'application/pdf'],
  },
  ALLOWED_EXTENSIONS: ['.txt', '.pdf'],
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(async () => undefined),
}));

import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { GET as getAnnouncements, POST as createAnnouncement } from '@/app/api/announcements/route';
import { GET as getAnnouncement, PUT as updateAnnouncement } from '@/app/api/announcements/[id]/route';
import { GET as getAnnouncementAttachment } from '@/app/api/announcements/attachments/[id]/route';
import { GET as getScheduledAnnouncements, POST as publishScheduledAnnouncements } from '@/app/api/announcements/scheduled/route';

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('announcements route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
  });

  it('filters out announcements outside the employee department in list API', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 101,
      username: 'employee',
      role: 'EMPLOYEE',
    });
    mockedPrisma.employee.findUnique.mockResolvedValue({ department: '人資部' } as never);
    mockedPrisma.announcement.findMany.mockResolvedValue([
      {
        id: 1,
        title: 'global',
        content: 'visible',
        priority: 'NORMAL',
        category: 'GENERAL',
        publisherId: 1,
        isPublished: true,
        publishedAt: new Date().toISOString(),
        expiryDate: null,
        scheduledPublishAt: null,
        targetDepartments: null,
        isGlobalAnnouncement: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        title: 'restricted',
        content: 'hidden',
        priority: 'NORMAL',
        category: 'GENERAL',
        publisherId: 1,
        isPublished: true,
        publishedAt: new Date().toISOString(),
        expiryDate: null,
        scheduledPublishAt: null,
        targetDepartments: JSON.stringify(['資訊部']),
        isGlobalAnnouncement: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ] as never);

    const response = await getAnnouncements(new NextRequest('http://localhost/api/announcements'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.announcements).toHaveLength(1);
    expect(payload.announcements[0].id).toBe(1);
    expect(payload.total).toBe(1);
  });

  it('blocks employee access to targeted announcement detail outside their department', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 101,
      username: 'employee',
      role: 'EMPLOYEE',
    });
    mockedPrisma.employee.findUnique.mockResolvedValue({ department: '人資部' } as never);
    mockedPrisma.announcement.findUnique.mockResolvedValue({
      id: 7,
      title: 'restricted',
      content: 'hidden',
      priority: 'NORMAL',
      category: 'GENERAL',
      publisherId: 1,
      isPublished: true,
      publishedAt: new Date().toISOString(),
      expiryDate: null,
      targetDepartments: JSON.stringify(['資訊部']),
      isGlobalAnnouncement: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attachments: [],
    } as never);

    const response = await getAnnouncement(
      new NextRequest('http://localhost/api/announcements/7'),
      { params: Promise.resolve({ id: '7' }) }
    );

    expect(response.status).toBe(403);
  });

  it('rejects announcement updates when CSRF validation fails', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 101,
      username: 'hr',
      role: 'HR',
    });
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: 'bad csrf' } as never);

    const response = await updateAnnouncement(
      new NextRequest('http://localhost/api/announcements/3', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'updated title' }),
      }),
      { params: Promise.resolve({ id: '3' }) }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'bad csrf' });
    expect(mockedPrisma.announcement.update).not.toHaveBeenCalled();
  });

  it('returns 400 when announcement update payload is malformed JSON', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 101,
      username: 'hr',
      role: 'HR',
    });

    const response = await updateAnnouncement(
      new NextRequest('http://localhost/api/announcements/3', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{bad-json',
      }),
      { params: Promise.resolve({ id: '3' }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '請求內容不是有效的 JSON' });
  });

  it('blocks employee downloads for attachments outside their department scope', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 101,
      username: 'employee',
      role: 'EMPLOYEE',
    });
    mockedPrisma.employee.findUnique.mockResolvedValue({ department: '人資部' } as never);
    mockedPrisma.announcementAttachment.findUnique.mockResolvedValue({
      id: 5,
      fileName: 'secret.txt',
      originalName: 'secret.txt',
      fileSize: 16,
      mimeType: 'text/plain',
      announcement: {
        isPublished: true,
        expiryDate: null,
        isGlobalAnnouncement: false,
        targetDepartments: JSON.stringify(['資訊部']),
      },
    } as never);

    const response = await getAnnouncementAttachment(
      new NextRequest('http://localhost/api/announcements/attachments/5'),
      { params: Promise.resolve({ id: '5' }) }
    );

    expect(response.status).toBe(403);
  });

  it('rejects invalid scheduled publish timestamps on create', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 101,
      username: 'admin',
      role: 'ADMIN',
    });

    const formData = new FormData();
    formData.set('title', '測試公告');
    formData.set('content', '內容');
    formData.set('scheduledPublishAt', 'not-a-date');

    const response = await createAnnouncement(
      new NextRequest('http://localhost/api/announcements', {
        method: 'POST',
        body: formData,
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: '定時發布時間 格式無效',
    });
  });

  it('excludes expired announcements from scheduled publish execution', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 101,
      username: 'admin',
      role: 'ADMIN',
    });
    mockedPrisma.announcement.findMany.mockResolvedValue([] as never);
    mockedPrisma.$executeRaw.mockResolvedValue(0 as never);

    const response = await publishScheduledAnnouncements(
      new NextRequest('http://localhost/api/announcements/scheduled', {
        method: 'POST',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.publishedCount).toBe(0);
    expect(mockedPrisma.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { expiryDate: null },
            { expiryDate: { gt: expect.any(Date) } },
          ],
        }),
      })
    );

    const rawQueryParts = mockedPrisma.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray | undefined;
    expect(rawQueryParts?.join(' ')).toContain('expiry_date IS NULL OR expiry_date >');
  });

  it('only lists non-expired pending scheduled announcements', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 101,
      username: 'hr',
      role: 'HR',
    });
    mockedPrisma.announcement.findMany.mockResolvedValue([] as never);

    const response = await getScheduledAnnouncements(
      new NextRequest('http://localhost/api/announcements/scheduled')
    );

    expect(response.status).toBe(200);
    expect(mockedPrisma.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { expiryDate: null },
            { expiryDate: { gt: expect.any(Date) } },
          ],
        }),
      })
    );
  });
});