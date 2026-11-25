import { NextRequest } from 'next/server';
import { DELETE, GET, POST, PUT } from '@/app/api/purchase-requests/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { getTaiwanNow } from '@/lib/timezone';

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    purchaseRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
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
    mockedPrisma.purchaseRequest.findMany.mockResolvedValue([] as never);
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
  describe('請購單號取號', () => {
    const post = () =>
      POST(new NextRequest('http://localhost:3000/api/purchase-requests', {
        method: 'POST',
        headers: { cookie: 'token=shared-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '採購筆電',
          category: 'IT_EQUIPMENT',
          items: JSON.stringify([{ name: '筆電', quantity: 1, unit: '台', price: 30000, note: '' }]),
          reason: '設備更新',
        }),
      }));
    const currentPrefix = () => {
      const now = getTaiwanNow();
      return `PR-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    };

    it('starts at 001 for a month without any request', async () => {
      await post();

      expect(mockedPrisma.purchaseRequest.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({ data: expect.objectContaining({ requestNumber: `${currentPrefix()}-001` }) })
      );
    });

    it('keeps counting past 999: the next number after 1000 is 1001, not 1000 again', async () => {
      const prefix = currentPrefix();
      // 001–1000 都已用過（以文字倒序，999 會排在 1000 後面）
      const used = Array.from({ length: 1000 }, (_, i) => ({ requestNumber: `${prefix}-${String(i + 1).padStart(3, '0')}` }));
      mockedPrisma.purchaseRequest.findMany.mockResolvedValue(used as never);

      await post();

      expect(mockedPrisma.purchaseRequest.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({ data: expect.objectContaining({ requestNumber: `${prefix}-1001` }) })
      );
    });

    it('gives the 1000th request of a month the number 1000 after 999', async () => {
      const prefix = currentPrefix();
      mockedPrisma.purchaseRequest.findMany.mockResolvedValue(
        Array.from({ length: 999 }, (_, i) => ({ requestNumber: `${prefix}-${String(i + 1).padStart(3, '0')}` })) as never
      );

      await post();

      expect(mockedPrisma.purchaseRequest.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({ data: expect.objectContaining({ requestNumber: `${prefix}-1000` }) })
      );
    });
  });

  describe('審核只允許處理一次', () => {
    const review = (status: 'APPROVED' | 'REJECTED') =>
      PUT(new NextRequest('http://localhost:3000/api/purchase-requests', {
        method: 'PUT',
        headers: { cookie: 'token=shared-session-token', 'content-type': 'application/json' },
        body: JSON.stringify({ id: 99, status, rejectReason: status === 'REJECTED' ? '預算不足' : undefined }),
      }));
    const makeTx = (row: { status: string }) => ({
      purchaseRequest: {
        // 與資料庫相同的比對更新：只有 status 仍符合條件的那一方能改成功
        updateMany: jest.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
          if (row.status !== where.status) return { count: 0 };
          row.status = data.status;
          return { count: 1 };
        }),
        findUniqueOrThrow: jest.fn(async () => ({ id: 99, status: row.status, employee: { id: 10 } })),
      },
      approvalReview: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      approvalInstance: { update: jest.fn().mockResolvedValue({ id: 5 }) },
    });

    beforeEach(() => {
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 1, role: 'ADMIN', employee: { id: 10, name: '管理員' } } as never);
    });

    it('records the decision, one review and the closed approval instance for a pending request', async () => {
      const row = { status: 'PENDING' };
      const tx = makeTx(row);
      mockedPrisma.$transaction.mockImplementation((async (callback: (t: unknown) => unknown) => callback(tx)) as never);

      const response = await review('APPROVED');

      expect(response.status).toBe(200);
      expect(tx.purchaseRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 99, status: 'PENDING' },
        data: expect.objectContaining({ status: 'APPROVED', approvedBy: 10 }),
      });
      expect(tx.approvalReview.create).toHaveBeenCalledTimes(1);
      expect(tx.approvalInstance.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: 'APPROVED', currentLevel: 2 },
      });
    });

    it('lets only one of two simultaneous reviewers decide; the other is told it was already handled', async () => {
      const row = { status: 'PENDING' };
      const tx = makeTx(row);
      mockedPrisma.$transaction.mockImplementation((async (callback: (t: unknown) => unknown) => callback(tx)) as never);
      // 兩個審核者都讀到「待審」，都通過交易前的狀態檢查
      mockedPrisma.purchaseRequest.findUnique.mockResolvedValue({ id: 99, employeeId: 10, status: 'PENDING' } as never);

      const [approved, rejected] = await Promise.all([review('APPROVED'), review('REJECTED')]);

      const statuses = [approved.status, rejected.status].sort();
      expect(statuses).toEqual([200, 400]);
      const loser = approved.status === 400 ? approved : rejected;
      expect((await loser.json()).error).toBe('此請購單已處理');
      // 最後只保留先到那一方的結果，只寫一筆審核紀錄、只結案一次
      expect(row.status).toBe(approved.status === 200 ? 'APPROVED' : 'REJECTED');
      expect(tx.approvalReview.create).toHaveBeenCalledTimes(1);
      expect(tx.approvalInstance.update).toHaveBeenCalledTimes(1);
    });
  });
});
