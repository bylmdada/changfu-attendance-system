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

describe('announcements route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
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
});