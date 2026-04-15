import { NextRequest } from 'next/server';
import { DELETE, GET, POST, PUT } from '@/app/api/purchase-requests/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    purchaseRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    approvalInstance: {
      findFirst: jest.fn(),
    },
    approvalReview: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('purchase requests delete guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'owner',
      role: 'EMPLOYEE',
      sessionId: 'session-1',
    } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true });

    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      role: 'EMPLOYEE',
      employee: {
        id: 10,
        name: '王小明',
      },
    } as never);

    mockedPrisma.purchaseRequest.findUnique.mockResolvedValue({
      id: 99,
      employeeId: 10,
      status: 'PENDING',
    } as never);

    mockedPrisma.purchaseRequest.delete.mockResolvedValue({
      id: 99,
    } as never);
  });

  it('rejects GET requests when shared request auth cannot resolve a user', async () => {
    mockedGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/purchase-requests');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('未登入');
  });

  it('accepts shared token cookie extraction on DELETE requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/purchase-requests?id=99', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ message: '已刪除' });
  });

  it('rejects DELETE requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost:3000/api/purchase-requests?id=99', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
  });

  it('rejects POST requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'POST',
      headers: {
        cookie: 'token=shared-session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: '採購筆電',
        items: JSON.stringify([{ name: '筆電', quantity: 1, price: 30000 }]),
        reason: '設備更新',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
  });

  it('rejects PUT requests with an invalid CSRF token', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });

    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'PUT',
      headers: {
        cookie: 'token=shared-session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 99, status: 'APPROVED' }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
  });

  it('rejects POST requests when shared request auth cannot resolve a user', async () => {
    mockedGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-token',
      },
      body: JSON.stringify({
        title: '採購筆電',
        items: JSON.stringify([{ name: '筆電', quantity: 1, price: 30000 }]),
        reason: '設備更新',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('未登入');
  });

  it('rejects malformed JSON on POST before creating purchase requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'POST',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: '{"title":',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
    expect(mockedPrisma.purchaseRequest.create).not.toHaveBeenCalled();
  });

  it('rejects null JSON bodies on POST before creating purchase requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'POST',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的請購資料');
    expect(mockedPrisma.purchaseRequest.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on PUT before updating purchase requests', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      role: 'ADMIN',
      employee: {
        id: 10,
        name: '王小明',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'PUT',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: '{"id":',
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
    expect(mockedPrisma.purchaseRequest.update).not.toHaveBeenCalled();
  });

  it('rejects null JSON bodies on PUT before updating purchase requests', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      role: 'ADMIN',
      employee: {
        id: 10,
        name: '王小明',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'PUT',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的請購審核資料');
    expect(mockedPrisma.purchaseRequest.update).not.toHaveBeenCalled();
  });
});