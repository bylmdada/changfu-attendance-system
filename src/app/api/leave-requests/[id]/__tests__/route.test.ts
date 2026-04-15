import { NextRequest } from 'next/server';
import { DELETE, PATCH } from '@/app/api/leave-requests/[id]/route';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {},
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
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

describe('leave request item csrf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });
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
});