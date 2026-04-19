import { NextRequest } from 'next/server';
import { DELETE, GET, PUT } from '@/app/api/announcements/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    announcement: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    announcementAttachment: {
      findMany: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
    approvalInstance: {
      findFirst: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    approvalReview: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
}));

jest.mock('fs/promises', () => ({
  unlink: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('announcement delete guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
      sessionId: 'session-1',
    } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true });
    mockedPrisma.announcementAttachment.findMany.mockResolvedValue([] as never);
    mockedPrisma.announcement.delete.mockResolvedValue({ id: 5 } as never);
    mockedPrisma.approvalInstance.findFirst.mockResolvedValue(null as never);
    mockedPrisma.approvalInstance.deleteMany.mockResolvedValue({ count: 1 } as never);
    mockedPrisma.approvalReview.create.mockResolvedValue({ id: 1 } as never);
    mockedPrisma.approvalInstance.update.mockResolvedValue({ id: 11, status: 'APPROVED', currentLevel: 2, maxLevel: 2 } as never);
    mockedPrisma.announcement.findUnique.mockResolvedValue({
      id: 5,
      title: 'dept announcement',
      content: 'content',
      priority: 'NORMAL',
      category: 'GENERAL',
      publisherId: 1,
      isPublished: true,
      publishedAt: new Date().toISOString(),
      expiryDate: null,
      isGlobalAnnouncement: false,
      targetDepartments: JSON.stringify(['HR']),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    mockedPrisma.employee.findUnique.mockResolvedValue({ department: 'Sales' } as never);
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockedPrisma) => Promise<unknown>) => callback(mockedPrisma));
  });

  it('rejects DELETE requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost:3000/api/announcements/5', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
  });

  it('blocks employees from reading announcements for another department', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 50,
      username: 'employee',
      role: 'EMPLOYEE',
      sessionId: 'session-1',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/announcements/5', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('無權限查看此公告');
  });

  it('rejects GET requests with mixed announcement IDs instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost:3000/api/announcements/5abc', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: '5abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的公告ID');
    expect(mockedPrisma.announcement.findUnique).not.toHaveBeenCalled();
  });

  it('rejects PUT requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' } as never);

    const request = new NextRequest('http://localhost:3000/api/announcements/5', {
      method: 'PUT',
      body: JSON.stringify({ title: 'updated' }),
      headers: {
        'content-type': 'application/json',
      },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedPrisma.announcement.update).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON on PUT', async () => {
    const request = new NextRequest('http://localhost:3000/api/announcements/5', {
      method: 'PUT',
      body: '{"title":',
      headers: {
        'content-type': 'application/json',
      },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('JSON');
    expect(mockedPrisma.announcement.update).not.toHaveBeenCalled();
  });

  it('rejects PUT requests with mixed announcement IDs instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost:3000/api/announcements/5abc', {
      method: 'PUT',
      body: JSON.stringify({ title: 'updated' }),
      headers: {
        'content-type': 'application/json',
      },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的公告ID');
    expect(mockedPrisma.announcement.update).not.toHaveBeenCalled();
  });

  it('rejects DELETE requests with mixed announcement IDs instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost:3000/api/announcements/5abc', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的公告ID');
    expect(mockedPrisma.announcementAttachment.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.announcement.delete).not.toHaveBeenCalled();
  });

  it('keeps the original publishedAt timestamp when editing an already published announcement', async () => {
    mockedPrisma.announcement.update.mockResolvedValue({
      id: 5,
      title: 'updated',
      content: 'content',
      priority: 'NORMAL',
      category: 'GENERAL',
      publisherId: 1,
      isPublished: true,
      publishedAt: '2025-01-01T00:00:00.000Z',
      expiryDate: null,
      isGlobalAnnouncement: true,
      targetDepartments: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    mockedPrisma.announcement.findUnique.mockResolvedValue({
      id: 5,
      title: 'published announcement',
      content: 'content',
      priority: 'NORMAL',
      category: 'GENERAL',
      publisherId: 1,
      isPublished: true,
      publishedAt: '2025-01-01T00:00:00.000Z',
      expiryDate: null,
      isGlobalAnnouncement: true,
      targetDepartments: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    const request = new NextRequest('http://localhost:3000/api/announcements/5', {
      method: 'PUT',
      body: JSON.stringify({ title: 'updated', isPublished: true }),
      headers: {
        'content-type': 'application/json',
      },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(200);
    expect(mockedPrisma.announcement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.not.objectContaining({
          publishedAt: expect.anything(),
        }),
      })
    );
  });

  it('approves pending announcement flows when publishing from the management page', async () => {
    mockedPrisma.announcement.update.mockResolvedValue({
      id: 5,
      title: 'published',
      content: 'content',
      priority: 'NORMAL',
      category: 'GENERAL',
      publisherId: 1,
      isPublished: true,
      publishedAt: new Date().toISOString(),
      expiryDate: null,
      isGlobalAnnouncement: true,
      targetDepartments: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    mockedPrisma.announcement.findUnique.mockResolvedValue({
      id: 5,
      title: 'draft announcement',
      content: 'content',
      priority: 'NORMAL',
      category: 'GENERAL',
      publisherId: 1,
      isPublished: false,
      publishedAt: null,
      expiryDate: null,
      isGlobalAnnouncement: true,
      targetDepartments: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    mockedPrisma.approvalInstance.findFirst.mockResolvedValue({
      id: 12,
      currentLevel: 1,
      maxLevel: 2,
      status: 'PENDING',
    } as never);
    mockedPrisma.employee.findUnique.mockResolvedValue({ name: '王小明' } as never);

    const request = new NextRequest('http://localhost:3000/api/announcements/5', {
      method: 'PUT',
      body: JSON.stringify({ title: 'draft announcement', isPublished: true }),
      headers: {
        'content-type': 'application/json',
      },
    });

    const response = await PUT(request, { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(200);
    expect(mockedPrisma.approvalReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          instanceId: 12,
          reviewerId: 10,
          reviewerName: '王小明',
          reviewerRole: 'ADMIN',
          action: 'APPROVE',
        }),
      })
    );
    expect(mockedPrisma.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: {
        status: 'APPROVED',
        currentLevel: 2,
      },
    });
  });

  it('removes linked approval instances when deleting an announcement', async () => {
    const request = new NextRequest('http://localhost:3000/api/announcements/5', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(200);
    expect(mockedPrisma.approvalInstance.deleteMany).toHaveBeenCalledWith({
      where: {
        requestType: 'ANNOUNCEMENT',
        requestId: 5,
      },
    });
    expect(mockedPrisma.announcement.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });
});
