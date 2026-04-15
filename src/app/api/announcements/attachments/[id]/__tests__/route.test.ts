import { NextRequest } from 'next/server';
import { DELETE, GET } from '@/app/api/announcements/attachments/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    announcementAttachment: {
      findUnique: jest.fn(),
      delete: jest.fn(),
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
  readFile: jest.fn(),
  unlink: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('announcement attachment delete guards', () => {
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
    mockedPrisma.announcementAttachment.findUnique.mockResolvedValue({
      id: 7,
      fileName: 'file.pdf',
      announcement: {
        isPublished: true,
        expiryDate: null,
        isGlobalAnnouncement: false,
        targetDepartments: JSON.stringify(['HR']),
      },
    } as never);
    mockedPrisma.employee.findUnique.mockResolvedValue({ department: 'HR' } as never);
    mockedPrisma.announcementAttachment.delete.mockResolvedValue({ id: 7 } as never);
  });

  it('accepts shared token cookie extraction on DELETE requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/announcements/attachments/7', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '7' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: '附件刪除成功',
    });
  });

  it('rejects DELETE requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost:3000/api/announcements/attachments/7', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '7' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
  });

  it('rejects GET requests when shared request auth cannot resolve a user', async () => {
    mockedGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/announcements/attachments/7', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: '7' }) });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('未授權訪問');
  });

  it('blocks employees from downloading attachments outside their target department', async () => {
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 2,
      employeeId: 22,
      username: 'employee',
      role: 'EMPLOYEE',
      sessionId: 'session-1',
    } as never);
    mockedPrisma.employee.findUnique.mockResolvedValue({ department: 'Sales' } as never);

    const request = new NextRequest('http://localhost:3000/api/announcements/attachments/7', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: '7' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('無權限下載此附件');
  });

  it('rejects GET requests with mixed attachment IDs instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost:3000/api/announcements/attachments/7abc', {
      method: 'GET',
    });

    const response = await GET(request, { params: Promise.resolve({ id: '7abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的附件ID' });
    expect(mockedPrisma.announcementAttachment.findUnique).not.toHaveBeenCalled();
  });

  it('rejects DELETE requests with mixed attachment IDs instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost:3000/api/announcements/attachments/7abc', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'x-csrf-token': 'csrf-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '7abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的附件ID' });
    expect(mockedPrisma.announcementAttachment.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.announcementAttachment.delete).not.toHaveBeenCalled();
  });
});