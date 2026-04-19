jest.mock('@/lib/database', () => ({
  prisma: {
    holiday: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { DELETE, GET, POST, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
let mockTxDeleteMany: jest.Mock;
let mockTxCreateMany: jest.Mock;

describe('holidays route validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);

    mockPrisma.holiday.findMany.mockResolvedValue([] as never);
    mockPrisma.holiday.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.holiday.delete.mockResolvedValue({ id: 1 } as never);
    mockPrisma.holiday.deleteMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.holiday.createMany.mockResolvedValue({ count: 1 } as never);
    mockTxDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    mockTxCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockImplementation(async (callback) => callback({
      holiday: {
        deleteMany: mockTxDeleteMany,
        createMany: mockTxCreateMany,
      },
    } as never) as never);
  });

  it('rejects invalid year filters on GET', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays?year=abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('年份格式無效');
    expect(mockPrisma.holiday.findMany).not.toHaveBeenCalled();
  });

  it('rejects non-admin and non-hr users on GET', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      id: 2,
      username: 'employee',
      role: 'EMPLOYEE',
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/holidays');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('無權限');
    expect(mockPrisma.holiday.findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid year or date values on POST', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        year: 'abc',
        date: 'invalid-date',
        name: '測試假日',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('年份或日期格式無效');
    expect(mockPrisma.holiday.create).not.toHaveBeenCalled();
  });

  it('rejects null bodies on POST before destructuring holiday fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的設定資料');
    expect(mockPrisma.holiday.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies on POST before destructuring holiday fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"year":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.holiday.create).not.toHaveBeenCalled();
  });

  it('rejects impossible calendar dates on POST instead of normalizing them', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        year: 2026,
        date: '2026-02-30',
        name: '不存在的日期',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('年份或日期格式無效');
    expect(mockPrisma.holiday.create).not.toHaveBeenCalled();
  });

  it('rejects dates whose year does not match the provided year on POST', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        year: 2026,
        date: '2025-12-31',
        name: '跨年假日',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('年份或日期格式無效');
    expect(mockPrisma.holiday.create).not.toHaveBeenCalled();
  });

  it('rejects invalid batch import years on PUT', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        year: 'abc',
        holidays: [{ date: '2026-01-01', name: '元旦' }],
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('年份格式無效');
    expect(mockPrisma.holiday.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.holiday.createMany).not.toHaveBeenCalled();
  });

  it('rejects null bodies on PUT before destructuring holiday imports', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的設定資料');
    expect(mockPrisma.holiday.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.holiday.createMany).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies on PUT before destructuring holiday imports', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"year":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.holiday.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.holiday.createMany).not.toHaveBeenCalled();
  });

  it('rejects invalid ids on DELETE', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays?id=abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('假日 ID 格式無效');
    expect(mockPrisma.holiday.delete).not.toHaveBeenCalled();
  });

  it('returns 400 when batch import creates zero holidays', async () => {
    mockTxCreateMany.mockResolvedValueOnce({ count: 0 });

    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        year: 2026,
        holidays: [{ date: '2026-01-01', name: '元旦' }],
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('假日匯入失敗，未新增任何資料');
  });

  it('rejects impossible government-format dates on PUT instead of normalizing them', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        year: 2026,
        holidays: [{ date: '20260230', name: '不存在的日期' }],
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('假日列表包含無效的日期或名稱');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects imported holidays whose dates do not belong to the selected year on PUT', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        year: 2026,
        holidays: [{ date: '2025-12-31', name: '跨年假日' }],
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('假日列表包含無效的日期或名稱');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects duplicate holiday dates on PUT before deleting existing records', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/holidays', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        year: 2026,
        holidays: [
          { date: '2026-01-01', name: '元旦' },
          { date: '20260101', name: '元旦（重複）' },
        ],
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('假日日期不可重複');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
