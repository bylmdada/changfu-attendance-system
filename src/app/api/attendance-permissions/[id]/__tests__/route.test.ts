import { NextRequest } from 'next/server';
import { DELETE, PATCH } from '@/app/api/attendance-permissions/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    attendancePermission: {
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

const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('attendance permission item csrf guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: false, error: '缺少CSRF令牌' });
  });

  it('rejects PATCH requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/attendance-permissions/3', {
      method: 'PATCH',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ permissions: { attendance: ['VIEW'] } }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '3' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });

  it('rejects DELETE requests with an invalid CSRF token', async () => {
    const request = new NextRequest('http://localhost:3000/api/attendance-permissions/3', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '3' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('CSRF');
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
  });
});

describe('attendance permission item body guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 10,
      username: 'admin',
      role: 'ADMIN',
    } as never);
  });

  it('rejects malformed PATCH JSON bodies before updating permissions', async () => {
    const request = new NextRequest('http://localhost:3000/api/attendance-permissions/3', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=legacy-auth-token',
      },
      body: '{"permissions":',
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '3' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockPrisma.attendancePermission.update).not.toHaveBeenCalled();
  });

  it('rejects PATCH requests with mixed permission IDs instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost:3000/api/attendance-permissions/3abc', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: 'auth-token=legacy-auth-token',
      },
      body: JSON.stringify({
        permissions: {
          leaveRequests: ['VIEW'],
        },
      }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '3abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的權限ID' });
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
    expect(mockPrisma.attendancePermission.update).not.toHaveBeenCalled();
  });

  it('rejects DELETE requests with mixed permission IDs instead of partially parsing them', async () => {
    const request = new NextRequest('http://localhost:3000/api/attendance-permissions/3abc', {
      method: 'DELETE',
      headers: {
        cookie: 'auth-token=legacy-auth-token',
      },
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: '3abc' }) });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的權限ID' });
    expect(mockedGetUserFromRequest).not.toHaveBeenCalled();
    expect(mockPrisma.attendancePermission.delete).not.toHaveBeenCalled();
  });
});