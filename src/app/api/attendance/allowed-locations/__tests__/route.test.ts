jest.mock('@/lib/database', () => ({
  prisma: {
    allowedLocation: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn()
    }
  }
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn()
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn()
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn()
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { DELETE, POST, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('attendance allowed-locations validation guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({ userId: 1, role: 'ADMIN' } as never);
  });

  it('rejects malformed coordinate payloads instead of coercing partial numbers', async () => {
    const request = new NextRequest('http://localhost/api/attendance/allowed-locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '總部',
        latitude: '25.034abc',
        longitude: '121.5645',
        radius: '100'
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('緯度格式無效');
    expect(mockPrisma.allowedLocation.create).not.toHaveBeenCalled();
  });

  it('returns 400 when post body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/attendance/allowed-locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"總部"'
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.allowedLocation.create).not.toHaveBeenCalled();
  });

  it('rejects non-object post payloads before creating locations', async () => {
    const request = new NextRequest('http://localhost/api/attendance/allowed-locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(['總部'])
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.allowedLocation.create).not.toHaveBeenCalled();
  });

  it('returns 400 when put body contains malformed json', async () => {
    const request = new NextRequest('http://localhost/api/attendance/allowed-locations', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"id":1'
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.allowedLocation.update).not.toHaveBeenCalled();
  });

  it('rejects invalid optional field types on update before touching prisma', async () => {
    const request = new NextRequest('http://localhost/api/attendance/allowed-locations', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        department: { code: 'HR' },
        wifiEnabled: 'true'
      })
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('部門格式無效');
    expect(mockPrisma.allowedLocation.update).not.toHaveBeenCalled();
  });

  it('rejects malformed delete ids instead of truncating them with parseInt', async () => {
    const request = new NextRequest('http://localhost/api/attendance/allowed-locations?id=12abc', {
      method: 'DELETE'
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('缺少位置ID');
    expect(mockPrisma.allowedLocation.delete).not.toHaveBeenCalled();
  });
});