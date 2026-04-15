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
});