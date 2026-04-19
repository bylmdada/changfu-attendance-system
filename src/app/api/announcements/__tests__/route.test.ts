import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/announcements/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    announcement: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/upload-validation', () => ({
  validateFiles: jest.fn(() => ({ valid: true })),
  FILE_SIZE_LIMITS: {
    ATTACHMENT: 10 * 1024 * 1024,
    TOTAL_UPLOAD: 50 * 1024 * 1024,
  },
  ALLOWED_MIME_TYPES: {
    ALL: ['text/plain', 'application/pdf'],
  },
  ALLOWED_EXTENSIONS: {
    ALL: ['.txt', '.pdf'],
  },
}));

jest.mock('@/lib/realtime-notifications', () => ({
  sendNotification: jest.fn(),
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const { validateFiles } = jest.requireMock('@/lib/upload-validation') as {
  validateFiles: jest.Mock;
};
const { createApprovalForRequest } = jest.requireMock('@/lib/approval-helper') as {
  createApprovalForRequest: jest.Mock;
};

describe('announcements route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    validateFiles.mockReturnValue({ valid: true });
  });

  it('filters targeted announcements by employee department', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 3,
      employeeId: 30,
      username: 'employee',
      role: 'EMPLOYEE',
      sessionId: 'session-1',
    } as never);

    mockedPrisma.employee.findUnique.mockResolvedValue({ department: 'HR' } as never);
    mockedPrisma.announcement.findMany.mockResolvedValue([
      {
        id: 1,
        title: 'global',
        content: 'all',
        priority: 'NORMAL',
        category: 'GENERAL',
        publisherId: 10,
        isPublished: true,
        publishedAt: new Date().toISOString(),
        expiryDate: null,
        scheduledPublishAt: null,
        isGlobalAnnouncement: true,
        targetDepartments: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 2,
        title: 'hr only',
        content: 'hr',
        priority: 'HIGH',
        category: 'GENERAL',
        publisherId: 10,
        isPublished: true,
        publishedAt: new Date().toISOString(),
        expiryDate: null,
        scheduledPublishAt: null,
        isGlobalAnnouncement: false,
        targetDepartments: JSON.stringify(['HR']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 3,
        title: 'sales only',
        content: 'sales',
        priority: 'LOW',
        category: 'GENERAL',
        publisherId: 10,
        isPublished: true,
        publishedAt: new Date().toISOString(),
        expiryDate: null,
        scheduledPublishAt: null,
        isGlobalAnnouncement: false,
        targetDepartments: JSON.stringify(['Sales']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ] as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/announcements'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.total).toBe(2);
    expect(payload.announcements.map((announcement: { id: number }) => announcement.id)).toEqual([1, 2]);
  });

  it('rejects invalid scheduled publish times with 400 instead of creating the announcement', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);

    const formData = new FormData();
    formData.append('title', 'Test announcement');
    formData.append('content', 'content');
    formData.append('scheduledPublishAt', 'not-a-date');
    formData.append('isGlobalAnnouncement', 'true');

    const response = await POST(new NextRequest('http://localhost:3000/api/announcements', {
      method: 'POST',
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('定時發布時間');
    expect(mockedPrisma.announcement.create).not.toHaveBeenCalled();
  });

  it('validates attachments before creating the announcement', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    validateFiles.mockReturnValue({ valid: false, error: '附件格式不支援' });

    const formData = new FormData();
    formData.append('title', 'Attachment test');
    formData.append('content', 'content');
    formData.append('isGlobalAnnouncement', 'true');
    formData.append('attachments', new File(['bad'], 'bad.exe', { type: 'application/octet-stream' }));

    const response = await POST(new NextRequest('http://localhost:3000/api/announcements', {
      method: 'POST',
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('附件格式不支援');
    expect(mockedPrisma.announcement.create).not.toHaveBeenCalled();
  });

  it('does not send unsupported status fields to prisma when creating announcements', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedPrisma.announcement.create.mockResolvedValue({
      id: 9,
      title: 'Published announcement',
      content: 'content',
      priority: 'NORMAL',
      category: 'GENERAL',
      publisherId: 10,
      isPublished: true,
      publishedAt: new Date().toISOString(),
      expiryDate: null,
      scheduledPublishAt: null,
      isGlobalAnnouncement: true,
      targetDepartments: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    const formData = new FormData();
    formData.append('title', 'Published announcement');
    formData.append('content', 'content');
    formData.append('isPublished', 'true');
    formData.append('isGlobalAnnouncement', 'true');

    const response = await POST(new NextRequest('http://localhost:3000/api/announcements', {
      method: 'POST',
      body: formData,
    }));

    expect(response.status).toBe(201);
    expect(mockedPrisma.announcement.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.announcement.create.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        data: expect.not.objectContaining({
          status: expect.anything(),
        }),
      })
    );
  });

  it('does not create approval instances for admin drafts', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedPrisma.announcement.create.mockResolvedValue({
      id: 10,
      title: 'Draft announcement',
      content: 'draft',
      priority: 'NORMAL',
      category: 'GENERAL',
      publisherId: 10,
      isPublished: false,
      publishedAt: null,
      expiryDate: null,
      scheduledPublishAt: null,
      isGlobalAnnouncement: true,
      targetDepartments: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    const formData = new FormData();
    formData.append('title', 'Draft announcement');
    formData.append('content', 'draft');
    formData.append('isPublished', 'false');
    formData.append('isGlobalAnnouncement', 'true');

    const response = await POST(new NextRequest('http://localhost:3000/api/announcements', {
      method: 'POST',
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.message).toBe('公告已儲存為草稿');
    expect(createApprovalForRequest).not.toHaveBeenCalled();
  });
});
