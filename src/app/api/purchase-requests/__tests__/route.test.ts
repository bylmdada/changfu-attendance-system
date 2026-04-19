import { NextRequest } from 'next/server';
import { DELETE, GET, POST, PUT } from '@/app/api/purchase-requests/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';

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

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedCreateApprovalForRequest = createApprovalForRequest as jest.MockedFunction<typeof createApprovalForRequest>;

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
    mockedPrisma.purchaseRequest.findFirst.mockResolvedValue(null as never);
    mockedPrisma.purchaseRequest.create.mockResolvedValue({
      id: 99,
      requestNumber: 'PR-202604-001',
      employeeId: 10,
      department: 'HR',
      title: '採購筆電',
      category: 'IT_EQUIPMENT',
      items: JSON.stringify([{ name: '筆電', quantity: 1, unit: '台', price: 30000, note: '' }]),
      totalAmount: 30000,
      reason: '設備更新',
      priority: 'NORMAL',
      status: 'PENDING',
      employee: {
        id: 10,
        employeeId: 'A001',
        name: '王小明',
        department: 'HR',
      },
    } as never);
    mockedPrisma.purchaseRequest.update.mockResolvedValue({
      id: 99,
      status: 'APPROVED',
      employee: {
        id: 10,
        employeeId: 'A001',
        name: '王小明',
        department: 'HR',
      },
    } as never);

    mockedPrisma.purchaseRequest.delete.mockResolvedValue({
      id: 99,
    } as never);
    mockedPrisma.approvalInstance.findFirst.mockResolvedValue({
      id: 5,
      currentLevel: 1,
      maxLevel: 2,
    } as never);
    mockedPrisma.approvalInstance.update.mockResolvedValue({ id: 5 } as never);
    mockedPrisma.approvalInstance.deleteMany.mockResolvedValue({ count: 1 } as never);
    mockedPrisma.approvalReview.create.mockResolvedValue({ id: 1 } as never);
    mockedPrisma.$transaction.mockImplementation(async (operations: unknown) => Promise.all(operations as Promise<unknown>[]) as never);
    mockedCreateApprovalForRequest.mockResolvedValue({ success: true, instance: { id: 5 } } as never);
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
    expect(mockedPrisma.approvalInstance.deleteMany).toHaveBeenCalledWith({
      where: {
        requestType: 'PURCHASE',
        requestId: 99,
      },
    });
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

  it('rejects invalid items on POST before creating purchase requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'POST',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: '採購筆電',
        items: 'not-json',
        reason: '設備更新',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請至少填寫一項有效的採購項目');
    expect(mockedPrisma.purchaseRequest.create).not.toHaveBeenCalled();
  });

  it('rolls back the purchase request when approval flow creation fails on POST', async () => {
    mockedCreateApprovalForRequest.mockResolvedValue({ success: false, error: new Error('workflow failed') } as never);

    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'POST',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: '採購筆電',
        category: 'IT_EQUIPMENT',
        items: JSON.stringify([{ name: '筆電', quantity: 1, unit: '台', price: 30000, note: '' }]),
        reason: '設備更新',
        priority: 'NORMAL',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('建立請購審核流程失敗');
    expect(mockedPrisma.purchaseRequest.delete).toHaveBeenCalledWith({ where: { id: 99 } });
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

  it('requires a reject reason when rejecting a purchase request', async () => {
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
      body: JSON.stringify({ id: 99, status: 'REJECTED', rejectReason: '   ' }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請填寫駁回原因');
    expect(mockedPrisma.purchaseRequest.update).not.toHaveBeenCalled();
  });

  it('rejects approval updates when the approval instance is missing', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      role: 'ADMIN',
      employee: {
        id: 10,
        name: '王小明',
      },
    } as never);
    mockedPrisma.approvalInstance.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost:3000/api/purchase-requests', {
      method: 'PUT',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 99, status: 'APPROVED' }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('此請購單缺少審核流程，請聯絡管理員');
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid ids on DELETE before querying purchase requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/purchase-requests?id=99abc', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請購單 ID 格式無效');
    expect(mockedPrisma.purchaseRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects deleting processed requests even for admins', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 1,
      role: 'ADMIN',
      employee: {
        id: 10,
        name: '王小明',
      },
    } as never);
    mockedPrisma.purchaseRequest.findUnique.mockResolvedValue({
      id: 99,
      employeeId: 11,
      status: 'APPROVED',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/purchase-requests?id=99', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
        'x-csrf-token': 'csrf-token',
      },
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('只能刪除待審核的申請');
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
