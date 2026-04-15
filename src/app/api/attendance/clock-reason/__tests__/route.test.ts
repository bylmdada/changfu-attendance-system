import { NextRequest } from 'next/server';

import { POST } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    attendanceRecord: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    overtimeRequest: {
      create: jest.fn(),
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

describe('attendance clock-reason route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCSRF.mockResolvedValue({ valid: true });
  });

  it('rejects null request bodies before destructuring clock reason payload', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 5,
      username: 'employee',
      role: 'EMPLOYEE',
    });

    const request = new NextRequest('http://localhost/api/attendance/clock-reason', {
      method: 'POST',
      body: 'null',
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '缺少必要參數' });
    expect(mockPrisma.attendanceRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before destructuring clock reason payload', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 5,
      username: 'employee',
      role: 'EMPLOYEE',
    });

    const request = new NextRequest('http://localhost/api/attendance/clock-reason', {
      method: 'POST',
      body: '{"recordId":',
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.attendanceRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects POST when csrf validation fails before querying attendance records', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 5,
      username: 'employee',
      role: 'EMPLOYEE',
    });
    mockValidateCSRF.mockResolvedValue({ valid: false });

    const request = new NextRequest('http://localhost/api/attendance/clock-reason', {
      method: 'POST',
      body: JSON.stringify({
        recordId: 123,
        clockType: 'out',
        reason: 'BUSINESS',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('CSRF');
    expect(mockPrisma.attendanceRecord.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
  });

  it('rejects invalid quick overtime time windows before creating a linked overtime request', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 55,
      username: 'employee',
      role: 'EMPLOYEE',
    });
    mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 123,
      employeeId: 55,
      workDate: new Date('2026-04-11T00:00:00.000Z'),
      employee: { id: 55, name: '員工甲' },
    } as never);
    mockPrisma.user.findFirst.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost/api/attendance/clock-reason', {
      method: 'POST',
      body: JSON.stringify({
        recordId: 123,
        clockType: 'out',
        reason: 'BUSINESS',
        newOvertimeRequest: {
          startTime: '19:00',
          endTime: '18:00',
          hours: 8,
          overtimeReason: 'test'
        }
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('加班時間格式無效');
    expect(mockPrisma.overtimeRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.update).not.toHaveBeenCalled();
  });

  it('calculates linked overtime hours server-side instead of trusting client supplied hours', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 55,
      username: 'employee',
      role: 'EMPLOYEE',
    });
    mockPrisma.attendanceRecord.findUnique.mockResolvedValue({
      id: 123,
      employeeId: 55,
      workDate: new Date('2026-04-11T00:00:00.000Z'),
      employee: { id: 55, name: '員工甲' },
    } as never);
    mockPrisma.user.findFirst.mockResolvedValue({ id: 5 } as never);
    mockPrisma.overtimeRequest.create.mockResolvedValue({ id: 777 } as never);
    mockPrisma.attendanceRecord.update.mockResolvedValue({ id: 123 } as never);

    const request = new NextRequest('http://localhost/api/attendance/clock-reason', {
      method: 'POST',
      body: JSON.stringify({
        recordId: 123,
        clockType: 'out',
        reason: 'BUSINESS',
        newOvertimeRequest: {
          startTime: '18:00',
          endTime: '18:30',
          hours: 99,
          overtimeReason: '補半小時'
        }
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.overtimeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 55,
        overtimeDate: new Date('2026-04-11T00:00:00.000Z'),
        startTime: '18:00',
        endTime: '18:30',
        totalHours: 0.5,
        reason: '補半小時',
        status: 'PENDING'
      })
    });
  });
});