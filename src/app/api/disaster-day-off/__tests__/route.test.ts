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
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
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
    mockPrisma.schedule.delete.mockResolvedValue({ id: 100 } as never);
    mockPrisma.disasterDayOff.create.mockResolvedValue({
      id: 1,
      disasterDate: '2026-07-06',
      creator: { id: 10, name: 'Admin', department: 'HR' },
    } as never);
    mockPrisma.disasterDayOff.update.mockResolvedValue({
      id: 1,
      disasterDate: '2026-07-06',
      disasterType: 'TYPHOON',
      stopWorkType: 'PM',
      description: '',
      creator: { id: 10, name: 'Admin', department: 'HR' },
    } as never);
    mockPrisma.$transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return input(mockPrisma);
      }

      return Promise.all(input as Promise<unknown>[]);
    });
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

  it('returns 400 on POST when disasterDate is not a real calendar date', async () => {
    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        disasterDate: '2026-02-30',
        disasterType: 'TYPHOON',
        stopWorkType: 'FULL',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('日期格式不正確');
    expect(mockPrisma.disasterDayOff.create).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when any requested date already has a disaster record', async () => {
    mockPrisma.disasterDayOff.findMany.mockResolvedValue([
      { disasterDate: '2026-07-06' },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        disasterDate: '2026-07-06',
        numberOfDays: 1,
        disasterType: 'TYPHOON',
        stopWorkType: 'FULL',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('以下日期已設定天災假：2026-07-06');
    expect(mockPrisma.disasterDayOff.create).not.toHaveBeenCalled();
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

  it('updates TD schedules when stop work type changes on PUT', async () => {
    mockPrisma.disasterDayOff.findUnique.mockResolvedValue({
      id: 1,
      disasterDate: '2026-07-06',
      disasterType: 'TYPHOON',
      stopWorkType: 'FULL',
      description: '',
      originalSchedules: JSON.stringify([
        {
          employeeId: 11,
          existed: true,
          shiftType: 'A',
          startTime: '08:00',
          endTime: '17:00',
        },
      ]),
    } as never);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 88,
      shiftType: 'TD',
      startTime: '00:00',
      endTime: '23:59',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/disaster-day-off', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        stopWorkType: 'PM',
      }),
    });

    const response = await PUT(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockPrisma.schedule.update).toHaveBeenCalledWith({
      where: { id: 88 },
      data: {
        startTime: '12:00',
        endTime: '23:59',
      },
    });
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

  it('deletes generated TD schedules when removing a record with no original schedule', async () => {
    mockPrisma.disasterDayOff.findUnique.mockResolvedValue({
      id: 1,
      disasterDate: '2026-07-06',
      originalSchedules: JSON.stringify([
        {
          employeeId: 11,
          existed: false,
          shiftType: null,
          startTime: null,
          endTime: null,
        },
      ]),
    } as never);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 88,
      shiftType: 'TD',
      startTime: '00:00',
      endTime: '23:59',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/disaster-day-off?id=1', {
      method: 'DELETE',
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockPrisma.schedule.delete).toHaveBeenCalledWith({
      where: { id: 88 },
    });
  });

  it('returns 409 on DELETE when an affected schedule is no longer TD', async () => {
    mockPrisma.disasterDayOff.findUnique.mockResolvedValue({
      id: 1,
      disasterDate: '2026-07-06',
      originalSchedules: JSON.stringify([
        {
          employeeId: 11,
          existed: true,
          shiftType: 'A',
          startTime: '08:00',
          endTime: '17:00',
        },
      ]),
    } as never);
    mockPrisma.schedule.findUnique.mockResolvedValue({
      id: 88,
      shiftType: 'A',
      startTime: '08:00',
      endTime: '17:00',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/disaster-day-off?id=1', {
      method: 'DELETE',
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe('有 1 筆班表已被改為非 TD，請先確認班表後再刪除天災假記錄');
    expect(mockPrisma.disasterDayOff.delete).not.toHaveBeenCalled();
  });
});
