import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/overtime-requests/[id]/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
    departmentManager: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/email', () => ({
  notifyOvertimeApproval: jest.fn(),
}));

jest.mock('@/lib/salary-utils', () => ({
  calculateOvertimePayForRequest: jest.fn(),
}));

jest.mock('@/lib/timezone', () => ({
  toTaiwanDateStr: jest.fn(),
  getTaiwanYearMonth: jest.fn(),
}));

jest.mock('@/lib/hr-notification', () => ({
  notifyHRAfterManagerReview: jest.fn(),
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn().mockResolvedValue({ enableCC: false }),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('overtime request item authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockedGetUserFromRequest.mockResolvedValue({
      role: 'MANAGER',
      employeeId: 99,
      userId: 199,
    } as never);
    mockPrisma.overtimeRequest.findUnique.mockResolvedValue({
      id: 5,
      employeeId: 10,
      status: 'PENDING',
      overtimeDate: new Date('2026-04-01T00:00:00.000Z'),
      totalHours: 2,
      compensationType: 'OVERTIME_PAY',
      employee: {
        id: 10,
        name: '王小明',
        department: '製造部',
      },
    } as never);
  });

  it('rejects manager review when the request employee is outside managed departments', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '人資部' },
    ] as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('權限');
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
  });

  it('allows manager review when the employee department is managed', async () => {
    mockPrisma.departmentManager.findMany.mockResolvedValue([
      { department: '製造部' },
    ] as never);
    mockPrisma.employee.findUnique.mockResolvedValue({ name: '李主管' } as never);
    mockPrisma.overtimeRequest.update.mockResolvedValue({ id: 5 } as never);

    const request = new NextRequest('http://localhost:3000/api/overtime-requests/5', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: '5' }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.overtimeRequest.update).toHaveBeenCalled();
  });

  it('rejects malformed ids on PATCH before querying Prisma', async () => {
    const request = new NextRequest('http://localhost:3000/api/overtime-requests/abc', {
      method: 'PATCH',
      headers: {
        cookie: 'token=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ opinion: 'AGREE' }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: 'abc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('加班申請 ID 格式錯誤');
    expect(mockPrisma.overtimeRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.overtimeRequest.update).not.toHaveBeenCalled();
  });
});