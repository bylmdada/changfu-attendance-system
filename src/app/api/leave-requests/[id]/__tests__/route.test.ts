import { NextRequest } from 'next/server';
import { DELETE, PATCH } from '@/app/api/leave-requests/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { validateLeaveRequest } from '@/lib/leave-rules-validator';

jest.mock('@/lib/database', () => ({
  prisma: {
    leaveRequest: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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

jest.mock('@/lib/leave-rules-validator', () => ({
  validateLeaveRequest: jest.fn(),
}));

jest.mock('@/lib/email', () => ({
  notifyLeaveApproval: jest.fn(),
}));

jest.mock('@/lib/hr-notification', () => ({
  notifyHRAfterManagerReview: jest.fn(),
}));

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn(),
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn(),
}));

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedValidateLeaveRequest = validateLeaveRequest as jest.MockedFunction<typeof validateLeaveRequest>;
const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('leave request item csrf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });
    mockedPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      leaveType: 'PERSONAL',
      reason: '個人事務',
      status: 'PENDING',
      startDate: new Date('2026-04-20T09:00:00'),
      endDate: new Date('2026-04-20T18:00:00'),
      totalDays: 1,
      employee: {
        id: 10,
        name: '員工甲',
        department: '製造部',
      },
    } as never);
    mockedPrisma.leaveRequest.findFirst.mockResolvedValue(null as never);
    mockedPrisma.leaveRequest.update.mockResolvedValue({ id: 5 } as never);
    mockedValidateLeaveRequest.mockResolvedValue({ valid: true } as never);
  });

  it('rejects PATCH requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'update' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('rejects DELETE requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('rejects malformed ids on DELETE before querying Prisma', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/abc', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: 'abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請假申請 ID 格式錯誤');
  });

  it('rejects null PATCH bodies before parsing leave request payload', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: 'null',
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('請提供有效的請假申請資料');
  });

  it('rejects malformed PATCH JSON before parsing leave request payload', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: '{"reason":',
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('無效的 JSON 格式');
  });

  it('rejects bereavement edits without a legal relationship reason', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);
    mockedPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      leaveType: 'BEREAVEMENT',
      reason: '配偶：治喪安排',
      status: 'PENDING',
      employee: {
        id: 10,
        name: '員工甲',
        department: '製造部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leaveType: 'BEREAVEMENT',
        reason: '治喪安排',
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('喪假申請原因需選擇法定亡故親屬關係');
    expect(mockedPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('allows legacy bereavement reasons to stay unchanged while editing other fields', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);
    mockedPrisma.leaveRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      leaveType: 'BEREAVEMENT',
      reason: '舊制喪假備註文字',
      status: 'PENDING',
      startDate: new Date('2026-04-20T09:00:00'),
      endDate: new Date('2026-04-20T18:00:00'),
      totalDays: 1,
      employee: {
        id: 10,
        name: '員工甲',
        department: '製造部',
      },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leaveType: 'BEREAVEMENT',
        startDate: '2026-04-20',
        endDate: '2026-04-20',
        startHour: '10',
        startMinute: '00',
        endHour: '18',
        endMinute: '00',
        reason: '舊制喪假備註文字',
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });

    expect(response.status).toBe(200);
    expect(mockedPrisma.leaveRequest.update).toHaveBeenCalled();
  });

  it('rejects edits that overlap another leave request', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);
    mockedPrisma.leaveRequest.findFirst.mockResolvedValue({
      id: 9,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leaveType: 'PERSONAL',
        startDate: '2026-04-20',
        endDate: '2026-04-20',
        startHour: '09',
        startMinute: '00',
        endHour: '18',
        endMinute: '00',
        reason: '個人重要事故需親自處理',
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('該時間段已有請假申請');
    expect(mockedPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });

  it('rejects edits that violate leave rules after changing the request period', async () => {
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'EMPLOYEE',
      employeeId: 10,
      userId: 110,
    } as never);
    mockedValidateLeaveRequest.mockResolvedValue({
      valid: false,
      error: '剩餘假別天數不足',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/leave-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        leaveType: 'PERSONAL',
        startDate: '2026-04-20',
        endDate: '2026-04-21',
        startHour: '09',
        startMinute: '00',
        endHour: '18',
        endMinute: '00',
        reason: '個人重要事故需親自處理',
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('剩餘假別天數不足');
    expect(mockedPrisma.leaveRequest.update).not.toHaveBeenCalled();
  });
});
