import { NextRequest } from 'next/server';
import { DELETE, POST, PUT } from '@/app/api/missed-clock-requests/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';

jest.mock('@/lib/database', () => ({
  prisma: {
    departmentManager: {
      findMany: jest.fn(),
    },
    missedClockRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    },
    attendanceRecord: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
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

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;

const transactionClient = {
  missedClockRequest: {
    update: jest.fn(),
  },
  attendanceRecord: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

describe('missed clock route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockCheckAttendanceFreeze.mockResolvedValue({ isFrozen: false } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 10,
      userId: 1,
    } as never);
    mockPrisma.departmentManager.findMany.mockResolvedValue([] as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('rejects malformed ids before reviewing missed clock requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 'bad-id', status: 'APPROVED' }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請ID格式錯誤');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('uses employeeId as approvedBy when approving missed clock requests', async () => {
    mockPrisma.missedClockRequest.findUnique.mockResolvedValue({
      id: 55,
      employeeId: 20,
      status: 'PENDING',
      workDate: new Date('2024-01-01T00:00:00.000Z'),
      clockType: 'CLOCK_IN',
      requestedTime: '09:00',
      employee: {
        id: 20,
        name: '員工',
      },
    } as never);
    transactionClient.missedClockRequest.update.mockResolvedValue({ id: 55 } as never);
    transactionClient.attendanceRecord.findFirst.mockResolvedValue(null as never);
    transactionClient.attendanceRecord.create.mockResolvedValue({ id: 88 } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 55, status: 'APPROVED' }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.missedClockRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.attendanceRecord.create).not.toHaveBeenCalled();
    expect(transactionClient.missedClockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 55 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
    expect(transactionClient.attendanceRecord.create).toHaveBeenCalledWith({
      data: {
        employeeId: 20,
        workDate: new Date('2024-01-01T00:00:00.000Z'),
        status: 'PRESENT',
        clockInTime: '09:00',
      },
    });
  });

  it('allows managers to submit opinions and escalates requests to pending admin', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 2,
    } as never);
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '製造部' },
    ] as never);
    mockPrisma.missedClockRequest.findUnique.mockResolvedValue({
      id: 77,
      employeeId: 20,
      status: 'PENDING',
      employee: {
        id: 20,
        name: '員工',
        department: '製造部',
        position: '作業員',
      },
    } as never);
    mockPrisma.missedClockRequest.update.mockResolvedValue({
      id: 77,
      status: 'PENDING_ADMIN',
      managerOpinion: 'AGREE',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 77, opinion: 'AGREE', remarks: '建議核准' }),
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.message).toBe('主管已審核，已轉交管理員決核');
    expect(mockPrisma.missedClockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 77 },
        data: expect.objectContaining({
          status: 'PENDING_ADMIN',
          managerReviewerId: 99,
          managerOpinion: 'AGREE',
          managerNote: '建議核准',
        }),
      })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows final reviewers to approve requests already escalated to pending admin', async () => {
    mockPrisma.missedClockRequest.findUnique.mockResolvedValue({
      id: 90,
      employeeId: 21,
      status: 'PENDING_ADMIN',
      workDate: new Date('2024-02-03T00:00:00.000Z'),
      clockType: 'CLOCK_OUT',
      requestedTime: '18:30',
      employee: {
        id: 21,
        name: '王小明',
        department: '行政部',
        position: '專員',
      },
    } as never);
    transactionClient.missedClockRequest.update.mockResolvedValue({ id: 90 } as never);
    transactionClient.attendanceRecord.findFirst.mockResolvedValue(null as never);
    transactionClient.attendanceRecord.create.mockResolvedValue({ id: 91 } as never);

    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 90, status: 'APPROVED' }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(200);
    expect(transactionClient.missedClockRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 90 },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 10,
        }),
      })
    );
    expect(transactionClient.attendanceRecord.create).toHaveBeenCalledWith({
      data: {
        employeeId: 21,
        workDate: new Date('2024-02-03T00:00:00.000Z'),
        status: 'PRESENT',
        clockOutTime: '18:30',
      },
    });
  });

  it('rejects null request bodies before destructuring missed clock submission payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的忘打卡申請資料');
    expect(mockPrisma.missedClockRequest.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating missed clock submission payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"workDate":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.missedClockRequest.create).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring missed clock review payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的忘打卡申請資料');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating missed clock review payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"id":',
    });

    const response = await PUT(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed ids before deleting missed clock requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 'bad-id' }),
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('申請ID格式錯誤');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before evaluating missed clock delete payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/missed-clock-requests', {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"id":',
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.missedClockRequest.findUnique).not.toHaveBeenCalled();
  });
});