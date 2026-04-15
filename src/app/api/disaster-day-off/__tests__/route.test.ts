import { NextRequest } from 'next/server';

import { DELETE, GET, POST, PUT } from '@/app/api/disaster-day-off/route';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';

jest.mock('@/lib/database', () => ({
  prisma: {
    disasterDayOff: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employee: {
      findMany: jest.fn(),
    },
    schedule: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('disaster day off route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);

    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      retryAfter: 0,
    } as never);

    mockValidateCSRF.mockResolvedValue({ valid: true } as never);

    mockPrisma.disasterDayOff.findMany.mockResolvedValue([] as never);
    mockPrisma.disasterDayOff.findFirst.mockResolvedValue(null as never);
    mockPrisma.disasterDayOff.findUnique.mockResolvedValue(null as never);
    mockPrisma.employee.findMany.mockResolvedValue([{ id: 11 }] as never);
    mockPrisma.schedule.findUnique.mockResolvedValue(null as never);
    mockPrisma.disasterDayOff.create.mockResolvedValue({
      id: 1,
      disasterDate: '2026-07-06',
      creator: { id: 10, name: 'Admin', department: 'HR' },
    } as never);
  });

  it('returns 400 on GET when year is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off?year=abc');

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('year 格式錯誤');
  });

  it('returns 400 on GET when month is out of range', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off?year=2026&month=13');

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('month 格式錯誤');
  });

  it('returns 400 on POST when body is null', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的天災假資料');
  });

  it('returns 400 on POST when body contains malformed JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"disasterDate":',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.disasterDayOff.create).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when affectedEmployeeIds is not an array for employee scope', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        disasterDate: '2026-07-06',
        disasterType: 'TYPHOON',
        stopWorkType: 'FULL',
        affectedScope: 'EMPLOYEES',
        affectedEmployeeIds: '12',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('affectedEmployeeIds 格式錯誤');
  });

  it('returns 400 on PUT when body is null', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的天災假資料');
  });

  it('returns 400 on PUT when body contains malformed JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{"id":',
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.disasterDayOff.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.disasterDayOff.update).not.toHaveBeenCalled();
  });

  it('returns 400 on PUT when id is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'abc' }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('記錄ID 格式錯誤');
  });

  it('returns 400 on DELETE when id is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off?id=abc', {
      method: 'DELETE',
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('記錄ID 格式錯誤');
  });
});