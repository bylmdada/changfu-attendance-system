jest.mock('@/lib/database', () => ({
  prisma: {
    departmentManager: {
      create: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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

describe('department managers route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockPrisma.departmentManager.findUnique.mockResolvedValue(null as never);
    mockPrisma.departmentManager.updateMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.departmentManager.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.departmentManager.delete.mockResolvedValue({ id: 1 } as never);
    mockPrisma.departmentManager.update.mockResolvedValue({ id: 1 } as never);
  });

  it('rejects non-numeric employee ids before creating department managers', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/department-managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        employeeId: 'abc',
        department: 'HR',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '員工 ID 必須為正整數' });
    expect(mockPrisma.departmentManager.create).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before destructuring manager payload fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/department-managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.departmentManager.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON POST bodies before destructuring manager payload fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/department-managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"employeeId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.departmentManager.create).not.toHaveBeenCalled();
  });

  it('rejects non-numeric manager ids before updating department managers', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/department-managers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'oops',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '主管設定 ID 必須為正整數' });
    expect(mockPrisma.departmentManager.findUnique).not.toHaveBeenCalled();
  });

  it('rejects null PUT bodies before destructuring manager update fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/department-managers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '請提供有效的設定資料' });
    expect(mockPrisma.departmentManager.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.departmentManager.update).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PUT bodies before destructuring manager update fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/department-managers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"id":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.departmentManager.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.departmentManager.update).not.toHaveBeenCalled();
  });

  it('rejects non-boolean permission flags before updating department managers', async () => {
    mockPrisma.departmentManager.findUnique.mockResolvedValue({
      id: 5,
      department: 'HR',
      isPrimary: true,
      canApproveLeave: true,
      canApproveOvertime: true,
      canApproveShift: true,
      canApprovePurchase: false,
      canSchedule: false,
      isActive: true,
    } as never);

    const request = new NextRequest('http://localhost/api/system-settings/department-managers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 5,
        canApproveLeave: 'yes',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '主管權限欄位必須為布林值' });
    expect(mockPrisma.departmentManager.update).not.toHaveBeenCalled();
  });

  it('rejects malformed delete ids instead of coercing them with parseInt', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/department-managers?id=12abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '缺少 ID' });
    expect(mockPrisma.departmentManager.delete).not.toHaveBeenCalled();
  });
});