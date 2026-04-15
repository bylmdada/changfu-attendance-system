import { NextRequest } from 'next/server';
import { GET, POST, PUT } from '@/app/api/holiday-compensations/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    holiday: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    holidayCompensation: {
      findMany: jest.fn(),
      upsert: jest.fn(),
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

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('holiday compensations auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      role: 'ADMIN',
      username: 'admin',
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'ADMIN', employeeId: 10 } as never);
    mockPrisma.holiday.findMany.mockResolvedValue([] as never);
    mockPrisma.holiday.findUnique.mockResolvedValue({
      id: 3,
      date: '2026-10-10',
      name: '國慶日',
      year: 2026,
    } as never);
    mockPrisma.holidayCompensation.findMany.mockResolvedValue([] as never);
    mockPrisma.holidayCompensation.upsert.mockResolvedValue({ id: 1 } as never);
    mockPrisma.holidayCompensation.update.mockResolvedValue({ id: 1 } as never);
  });

  it('returns 401 on GET when shared request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/holiday-compensations');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('未授權訪問');
  });

  it('rejects POST for non-admin roles resolved via shared request auth', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 50,
      role: 'EMPLOYEE',
      username: 'employee',
    } as never);
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'EMPLOYEE' } as never);

    const request = new NextRequest('http://localhost:3000/api/holiday-compensations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 50, holidayId: 3 }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('權限不足');
  });

  it('returns 400 on GET when year is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/holiday-compensations?year=abc');

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('year 格式錯誤');
  });

  it('returns 400 on GET when employeeId is malformed for admin queries', async () => {
    const request = new NextRequest('http://localhost:3000/api/holiday-compensations?year=2026&employeeId=abc');

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('employeeId 格式錯誤');
  });

  it('returns 400 on POST when body is null', async () => {
    const request = new NextRequest('http://localhost:3000/api/holiday-compensations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的補休資料');
  });

  it('returns 400 on POST when employeeId is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/holiday-compensations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 'abc', holidayId: 3 }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('employeeId 格式錯誤');
  });

  it('returns 400 on POST when body contains malformed JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/holiday-compensations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"employeeId":',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.holiday.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.holidayCompensation.upsert).not.toHaveBeenCalled();
  });

  it('returns 400 on PUT when body is null', async () => {
    const request = new NextRequest('http://localhost:3000/api/holiday-compensations', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的補休資料');
  });

  it('returns 400 on PUT when id is malformed', async () => {
    const request = new NextRequest('http://localhost:3000/api/holiday-compensations', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 'abc' }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('記錄ID 格式錯誤');
  });

  it('returns 400 on PUT when body contains malformed JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/holiday-compensations', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"id":',
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.holidayCompensation.update).not.toHaveBeenCalled();
  });
});