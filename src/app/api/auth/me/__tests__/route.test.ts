jest.mock('@/lib/auth', () => ({
  getAuthResultFromRequest: jest.fn()
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn()
    },
    departmentManager: {
      findFirst: jest.fn()
    },
    managerDeputy: {
      findFirst: jest.fn()
    },
    approvalDelegate: {
      findMany: jest.fn()
    },
    attendancePermission: {
      findUnique: jest.fn()
    }
  }
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  buildActiveDeputyAssignmentWhere: jest.fn((employeeId: number) => ({ employeeId }))
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/me/route';
import { getAuthResultFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';

const mockGetAuthResultFromRequest = getAuthResultFromRequest as jest.MockedFunction<typeof getAuthResultFromRequest>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('/api/auth/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only the minimum employee profile fields plus permission booleans', async () => {
    mockGetAuthResultFromRequest.mockResolvedValue({
      user: {
        userId: 7,
        username: 'staff.user',
        role: 'USER',
        sessionId: 'session-1'
      },
      reason: null
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      username: 'staff.user',
      role: 'USER',
      currentSessionId: 'session-1',
      employee: {
        id: 11,
        employeeId: 'EMP001',
        name: '測試員工',
        department: '資訊部',
        position: '工程師',
        baseSalary: 60000,
        hourlyRate: 350,
        insuredBase: 45800,
        dependents: 2,
        laborPensionSelfRate: 6
      }
    } as never);
    mockPrisma.departmentManager.findFirst.mockResolvedValue({ id: 1 } as never);
    mockPrisma.managerDeputy.findFirst.mockResolvedValue(null as never);
    mockPrisma.approvalDelegate.findMany.mockResolvedValue([] as never);
    mockPrisma.attendancePermission.findUnique.mockResolvedValue({
      permissions: {
        leaveRequests: ['資訊部'],
        overtimeRequests: ['資訊部', '人資部'],
        shiftExchanges: [],
        scheduleManagement: ['view', 'edit']
      }
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/auth/me'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        }
      }
    });
    expect(payload).toEqual({
      user: {
        id: 7,
        username: 'staff.user',
        role: 'USER',
        employeeId: 11,
        employee: {
          id: 11,
          employeeId: 'EMP001',
          name: '測試員工',
          department: '資訊部',
          position: '工程師'
        },
        isDepartmentManager: true,
        isDeputyManager: false,
        hasSchedulePermission: true,
        attendancePermissions: {
          leaveRequests: ['資訊部'],
          overtimeRequests: ['資訊部', '人資部'],
          shiftExchanges: [],
          scheduleManagement: ['view', 'edit']
        }
      }
    });
  });

  it('marks approval delegates as deputy managers when they proxy an active manager', async () => {
    mockGetAuthResultFromRequest.mockResolvedValue({
      user: {
        userId: 7,
        username: 'delegate.user',
        role: 'USER',
        sessionId: 'session-1'
      },
      reason: null
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 7,
      username: 'delegate.user',
      role: 'USER',
      currentSessionId: 'session-1',
      employee: {
        id: 11,
        employeeId: 'EMP001',
        name: '代理審核員',
        department: '資訊部',
        position: '工程師'
      }
    } as never);
    mockPrisma.departmentManager.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 2 } as never);
    mockPrisma.managerDeputy.findFirst.mockResolvedValue(null as never);
    mockPrisma.approvalDelegate.findMany.mockResolvedValue([{ delegatorId: 25 }] as never);
    mockPrisma.attendancePermission.findUnique.mockResolvedValue({ permissions: undefined } as never);

    const response = await GET(new NextRequest('http://localhost/api/auth/me'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.user.isDepartmentManager).toBe(false);
    expect(payload.user.isDeputyManager).toBe(true);
    expect(mockPrisma.approvalDelegate.findMany).toHaveBeenCalledWith({
      where: {
        delegateId: 11,
        isActive: true,
        startDate: { lte: expect.any(Date) },
        endDate: { gte: expect.any(Date) }
      },
      select: {
        delegatorId: true
      }
    });
  });

  it('rejects requests when the session no longer matches the active session', async () => {
    mockGetAuthResultFromRequest.mockResolvedValue({
      user: null,
      reason: 'session_invalid'
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/auth/me'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({
      error: '您已在其他裝置登入，此會話已失效',
      code: 'SESSION_INVALID'
    });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.departmentManager.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.managerDeputy.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.approvalDelegate.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.attendancePermission.findUnique).not.toHaveBeenCalled();
  });
});
