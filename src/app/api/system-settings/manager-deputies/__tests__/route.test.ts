jest.mock('@/lib/database', () => ({
  prisma: {
    managerDeputy: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
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
import { DELETE, POST, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('manager deputies route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.managerDeputy.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.managerDeputy.update.mockResolvedValue({ id: 1 } as never);
    mockPrisma.managerDeputy.delete.mockResolvedValue({ id: 1 } as never);
  });

  it('rejects non-numeric manager and deputy employee ids before creating deputy records', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        managerId: 'abc',
        deputyEmployeeId: 12,
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '主管與代理員工 ID 必須為正整數' });
    expect(mockPrisma.managerDeputy.create).not.toHaveBeenCalled();
  });

  it('rejects invalid deputy date strings before creating deputy records', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        managerId: 3,
        deputyEmployeeId: 12,
        startDate: 'not-a-date',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '代理日期格式無效' });
    expect(mockPrisma.managerDeputy.create).not.toHaveBeenCalled();
  });

  it('rejects null bodies on POST before destructuring deputy payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.managerDeputy.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON POST bodies before destructuring deputy payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"managerId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.managerDeputy.create).not.toHaveBeenCalled();
  });

  it('rejects non-numeric deputy ids before updating deputy records', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'oops',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '代理設定 ID 必須為正整數' });
    expect(mockPrisma.managerDeputy.update).not.toHaveBeenCalled();
  });

  it('rejects null bodies on PUT before destructuring deputy update payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.managerDeputy.update).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PUT bodies before destructuring deputy update payload', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"id":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.managerDeputy.update).not.toHaveBeenCalled();
  });

  it('preserves existing dates when partial updates only toggle the active flag', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 7,
        isActive: false,
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.managerDeputy.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isActive: false },
    });
  });

  it('rejects non-boolean active flags before updating deputy records', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 7,
        isActive: 'false',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '啟用狀態必須為布林值' });
    expect(mockPrisma.managerDeputy.update).not.toHaveBeenCalled();
  });

  it('rejects malformed delete ids instead of coercing them with parseInt', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/manager-deputies?id=12abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '缺少 ID' });
    expect(mockPrisma.managerDeputy.delete).not.toHaveBeenCalled();
  });
});