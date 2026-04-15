jest.mock('@/lib/database', () => ({
  prisma: {
    dependentEnrollmentLog: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
import { GET, POST, PUT } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('dependent enrollment route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);

    mockPrisma.dependentEnrollmentLog.findMany.mockResolvedValue([] as never);
    mockPrisma.dependentEnrollmentLog.create.mockResolvedValue({ id: 1 } as never);
    mockPrisma.dependentEnrollmentLog.update.mockResolvedValue({ id: 1 } as never);
  });

  it('rejects invalid year and month filters before building date ranges', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-enrollment?year=abc&month=13');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('年月篩選格式無效');
    expect(mockPrisma.dependentEnrollmentLog.findMany).not.toHaveBeenCalled();
  });

  it('rejects unsupported enrollment types on POST', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-enrollment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        dependentId: 10,
        employeeId: 20,
        dependentName: '王小華',
        employeeName: '王小明',
        type: 'INVALID',
        effectiveDate: '2026-03-01',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('加退保類型無效');
    expect(mockPrisma.dependentEnrollmentLog.create).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before destructuring enrollment fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-enrollment', {
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
    expect(mockPrisma.dependentEnrollmentLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON POST bodies before destructuring enrollment fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-enrollment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"dependentId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.dependentEnrollmentLog.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported report statuses on PUT', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-enrollment', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 1,
        reportStatus: 'INVALID',
      }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申報狀態無效');
    expect(mockPrisma.dependentEnrollmentLog.update).not.toHaveBeenCalled();
  });

  it('rejects null PUT bodies before destructuring report status fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-enrollment', {
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
    expect(mockPrisma.dependentEnrollmentLog.update).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON PUT bodies before destructuring report status fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/dependent-enrollment', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"id":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.dependentEnrollmentLog.update).not.toHaveBeenCalled();
  });
});