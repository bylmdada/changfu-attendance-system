import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/leave-requests/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { checkAttendanceFreeze } from '@/lib/attendance-freeze';
import { validateLeaveRequest } from '@/lib/leave-rules-validator';
import { createApprovalForRequest } from '@/lib/approval-helper';
import { getAttendancePermissionDepartments } from '@/lib/attendance-permission-scopes';

jest.mock('@/lib/database', () => ({
  prisma: {
    leaveRequest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    annualLeave: {
      findMany: jest.fn(),
    },
    schedule: {
      findMany: jest.fn(),
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

jest.mock('@/lib/attendance-freeze', () => ({
  checkAttendanceFreeze: jest.fn(),
}));

jest.mock('@/lib/leave-rules-validator', () => ({
  validateLeaveRequest: jest.fn(),
}));

jest.mock('@/lib/approval-helper', () => ({
  createApprovalForRequest: jest.fn(),
}));

jest.mock('@/lib/attendance-permission-scopes', () => ({
  getAttendancePermissionDepartments: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockCheckAttendanceFreeze = checkAttendanceFreeze as jest.MockedFunction<typeof checkAttendanceFreeze>;
const mockValidateLeaveRequest = validateLeaveRequest as jest.MockedFunction<typeof validateLeaveRequest>;
const mockCreateApprovalForRequest = createApprovalForRequest as jest.MockedFunction<typeof createApprovalForRequest>;
const mockGetAttendancePermissionDepartments = getAttendancePermissionDepartments as jest.MockedFunction<typeof getAttendancePermissionDepartments>;

describe('leave request list guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      employeeId: 1,
      userId: 101,
    } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockCheckAttendanceFreeze.mockResolvedValue({ isFrozen: false } as never);
    mockValidateLeaveRequest.mockResolvedValue({ valid: true } as never);
    mockCreateApprovalForRequest.mockResolvedValue(undefined as never);
    mockGetAttendancePermissionDepartments.mockResolvedValue(['製造部'] as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);
    mockPrisma.leaveRequest.findFirst.mockResolvedValue(null as never);
    mockPrisma.annualLeave.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
  });

  it('rejects malformed employeeId filters before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests?employeeId=10abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('employeeId 格式錯誤');
    expect(mockPrisma.leaveRequest.findMany).not.toHaveBeenCalled();
  });

  it('rejects null request bodies before destructuring leave request payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的請假申請資料');
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });

  it('limits non-admin leave list queries to permission departments', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      role: 'USER',
      employeeId: 8,
      userId: 108,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ leaveRequests: [] });
    expect(mockPrisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employee: {
            department: { in: ['製造部'] },
          },
        }),
      })
    );
  });

  it('adds annual leave balance metadata to annual leave list items', async () => {
    mockPrisma.leaveRequest.findMany.mockResolvedValue([
      {
        id: 10,
        employeeId: 8,
        leaveType: 'ANNUAL',
        startDate: new Date('2026-07-10T00:00:00.000Z'),
        endDate: new Date('2026-07-11T00:00:00.000Z'),
        totalDays: 2,
        totalHours: null,
        reason: null,
        status: 'PENDING',
        approvedBy: null,
        approvedAt: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        employee: {
          id: 8,
          employeeId: 'EMP008',
          name: '王小明',
          department: '製造部',
          position: '技術員',
        },
        approver: null,
      },
    ] as never);
    mockPrisma.annualLeave.findMany.mockResolvedValue([
      {
        employeeId: 8,
        year: 2026,
        remainingDays: 1,
        expiryDate: new Date('2026-12-31T00:00:00.000Z'),
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        employeeId: 8,
        workDate: '2026-07-10',
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 60,
      },
    ] as never);

    const response = await GET(new NextRequest('http://localhost:3000/api/leave-requests'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.annualLeave.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ employeeId: 8, year: 2026 }],
      },
      select: {
        employeeId: true,
        year: true,
        remainingDays: true,
        expiryDate: true,
      },
    });
    expect(payload.leaveRequests[0].annualLeaveBalance).toEqual({
      year: 2026,
      remainingDays: 1,
      expiryDate: '2026-12-31T00:00:00.000Z',
    });
    expect(payload.leaveRequests[0].leaveSchedules).toEqual([
      {
        employeeId: 8,
        workDate: '2026-07-10',
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 60,
      },
    ]);
  });

  it('rejects malformed JSON bodies before evaluating leave request payload fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"leaveType":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(mockCreateApprovalForRequest).not.toHaveBeenCalled();
  });

  it('rejects bereavement requests that do not use a legal relationship reason', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leaveType: 'BEREAVEMENT',
        startDate: '2026-04-20',
        endDate: '2026-04-20',
        startHour: '09',
        startMinute: '00',
        endHour: '18',
        endMinute: '00',
        reason: '治喪安排',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('喪假申請原因需選擇法定亡故親屬關係');
    expect(mockCheckAttendanceFreeze).not.toHaveBeenCalled();
    expect(mockValidateLeaveRequest).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled();
  });

  it('deducts scheduled break time before validating and creating timed leave requests', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        workDate: '2026-07-02',
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 60,
        workHours: 8,
      },
    ] as never);
    mockPrisma.leaveRequest.create.mockResolvedValue({
      id: 12,
      employee: {
        id: 1,
        name: '員工甲',
        department: '製造部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leaveType: 'BUSINESS_TRIP',
        startDate: '2026-07-02',
        endDate: '2026-07-02',
        startHour: '08',
        startMinute: '00',
        endHour: '17',
        endMinute: '00',
        reason: '外部會議',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.schedule.findMany).toHaveBeenCalledWith({
      where: {
        employeeId: 1,
        workDate: {
          gte: '2026-07-02',
          lte: '2026-07-02',
        },
      },
      select: {
        workDate: true,
        shiftType: true,
        startTime: true,
        endTime: true,
        breakTime: true,
        workHours: true,
      },
    });
    expect(mockValidateLeaveRequest).toHaveBeenCalledWith(1, 'BUSINESS_TRIP', 1, 2026);
    expect(mockPrisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalDays: 1,
        }),
      })
    );
  });

  it('accepts five-minute leave times and uses the employee department workflow', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        workDate: '2026-08-18',
        shiftType: 'B',
        startTime: '08:00',
        endTime: '17:00',
        breakTime: 60,
        workHours: 8,
      },
    ] as never);
    mockPrisma.leaveRequest.create.mockResolvedValue({
      id: 18,
      employee: {
        id: 1,
        name: '溪北員工',
        department: '溪北輔具中心',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        leaveType: 'SICK',
        startDate: '2026-08-18',
        endDate: '2026-08-18',
        startHour: '08',
        startMinute: '05',
        endHour: '09',
        endMinute: '10',
        reason: '就醫治療',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockPrisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        }),
      })
    );
    const createArgs = mockPrisma.leaveRequest.create.mock.calls[0][0] as {
      data: { startDate: Date; endDate: Date };
    };
    expect(createArgs.data.startDate.getMinutes()).toBe(5);
    expect(createArgs.data.endDate.getMinutes()).toBe(10);
    expect(mockCreateApprovalForRequest).toHaveBeenCalledWith({
      requestType: 'LEAVE',
      requestId: 18,
      applicantId: 1,
      applicantName: '溪北員工',
      department: '溪北輔具中心',
    });
  });
});
