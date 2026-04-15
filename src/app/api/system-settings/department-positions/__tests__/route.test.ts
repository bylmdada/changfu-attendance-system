import { NextRequest } from 'next/server';
import { DELETE, GET, POST, PUT } from '@/app/api/system-settings/department-positions/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    department: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    position: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
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

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('department positions route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, retryAfter: 60 } as never);
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedPrisma.department.findMany.mockResolvedValue([
      {
        id: 1,
        name: '人資部',
        sortOrder: 1,
        isActive: true,
        positions: [
          {
            id: 11,
            name: '專員',
            sortOrder: 1,
            isActive: true,
          },
        ],
      },
    ] as never);
    mockedPrisma.department.findUnique.mockResolvedValue({ id: 1, name: '人資部' } as never);
    mockedPrisma.department.update.mockResolvedValue({ id: 1, name: '人資部', sortOrder: 1, isActive: true, positions: [] } as never);
    mockedPrisma.department.delete.mockResolvedValue({ id: 1 } as never);
    mockedPrisma.position.findFirst.mockResolvedValue(null as never);
    mockedPrisma.position.findMany.mockResolvedValue([{ id: 11 }] as never);
    mockedPrisma.position.aggregate.mockResolvedValue({ _max: { sortOrder: 1 } } as never);
    mockedPrisma.position.create.mockResolvedValue({ id: 12, departmentId: 1, name: '主任', sortOrder: 2, isActive: true } as never);
    mockedPrisma.position.update.mockResolvedValue({ id: 11, departmentId: 1, name: '主任', sortOrder: 1, isActive: true } as never);
    mockedPrisma.position.delete.mockResolvedValue({ id: 11 } as never);
    mockedPrisma.position.deleteMany.mockResolvedValue({ count: 1 } as never);
  });

  it('rejects non-admin GET requests', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 2,
      username: 'user',
      role: 'HR',
      employee: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/system-settings/department-positions'));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({ error: '需要管理員權限' });
    expect(mockedPrisma.department.findMany).not.toHaveBeenCalled();
  });

  it('allows admin GET requests', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/system-settings/department-positions'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.departments).toHaveLength(1);
  });

  it('rejects invalid department ids on GET before filtering departments', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/system-settings/department-positions?departmentId=abc'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '部門 ID 格式無效' });
  });

  it('rejects invalid department ids on addPosition before querying departments', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'addPosition', departmentId: 'abc', name: '主任' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '部門 ID 格式無效' });
    expect(mockedPrisma.department.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null bodies on POST before destructuring action fields', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請提供有效的設定資料' });
    expect(mockedPrisma.department.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.position.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on POST before querying departments', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrisma.department.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.position.create).not.toHaveBeenCalled();
  });

  it('rejects invalid ids on updateDepartment before updating records', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'updateDepartment', id: 'abc', name: '新部門' }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'ID 格式無效' });
    expect(mockedPrisma.department.update).not.toHaveBeenCalled();
  });

  it('rejects null bodies on PUT before destructuring action fields', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請提供有效的設定資料' });
    expect(mockedPrisma.department.update).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on PUT before updating records', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrisma.department.update).not.toHaveBeenCalled();
    expect(mockedPrisma.position.update).not.toHaveBeenCalled();
  });

  it('rejects non-string department names on updateDepartment before updating records', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'updateDepartment', id: 1, name: 123 }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '部門名稱格式無效' });
    expect(mockedPrisma.department.update).not.toHaveBeenCalled();
  });

  it('rejects invalid sortOrder types on updatePosition before updating records', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'updatePosition', id: 11, sortOrder: '2' }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '排序值格式無效' });
    expect(mockedPrisma.position.update).not.toHaveBeenCalled();
  });

  it('rejects reorderPositions payloads containing non-object items before updating records', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'reorderPositions',
        positions: [null, { id: 11, sortOrder: 1 }],
      }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的職位排序資料' });
    expect(mockedPrisma.position.update).not.toHaveBeenCalled();
  });

  it('rejects invalid ids on deletePosition before deleting records', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'deletePosition', id: 'abc' }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'ID 格式無效' });
    expect(mockedPrisma.position.delete).not.toHaveBeenCalled();
  });

  it('rejects null bodies on DELETE before destructuring action fields', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請提供有效的設定資料' });
    expect(mockedPrisma.position.delete).not.toHaveBeenCalled();
    expect(mockedPrisma.department.delete).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON on DELETE before deleting records', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrisma.position.delete).not.toHaveBeenCalled();
    expect(mockedPrisma.department.delete).not.toHaveBeenCalled();
  });

  it('returns partial delete details for deletePositions so the frontend can preserve failed selections', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
    mockedPrisma.position.findMany.mockResolvedValueOnce([{ id: 11 }] as never);
    mockedPrisma.position.deleteMany.mockResolvedValueOnce({ count: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/department-positions', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'deletePositions', ids: [11, 12] }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      message: '已刪除 1 個職位',
      deletedCount: 1,
      deletedIds: [11],
      failedIds: [12],
    });
    expect(mockedPrisma.position.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [11] } },
    });
  });
});