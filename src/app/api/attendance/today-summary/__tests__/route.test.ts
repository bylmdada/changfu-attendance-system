import { NextRequest } from 'next/server';
import { GET } from '@/app/api/attendance/today-summary/route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    attendanceRecord: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    schedule: {
      findFirst: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('attendance today summary authorization guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.attendanceRecord.findFirst.mockResolvedValue(null as never);
    mockPrisma.schedule.findFirst.mockResolvedValue(null as never);
    mockPrisma.attendanceRecord.count.mockResolvedValue(12 as never);
  });

  it('does not expose company attendance counts to users who only have a manager title', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 5,
      employeeId: 50,
      role: 'EMPLOYEE',
      username: 'line-manager',
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 5,
      role: 'EMPLOYEE',
      isActive: true,
      employee: {
        id: 50,
        employeeId: 'E050',
        name: 'Line Manager',
        department: '製造部',
        position: 'MANAGER',
      },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.attendanceCount).toBeUndefined();
    expect(mockPrisma.attendanceRecord.count).not.toHaveBeenCalled();
  });

  it('still returns company attendance counts for HR users', async () => {
    mockGetUserFromRequest.mockResolvedValue({
      userId: 6,
      employeeId: 60,
      role: 'HR',
      username: 'hr-user',
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 6,
      role: 'HR',
      isActive: true,
      employee: {
        id: 60,
        employeeId: 'E060',
        name: 'HR User',
        department: '人資部',
        position: 'SPECIALIST',
      },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.attendanceCount).toBe(12);
    expect(mockPrisma.attendanceRecord.count).toHaveBeenCalledTimes(1);
  });

  it('uses Taiwan day boundaries for personal and company attendance queries', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-07T22:30:00.000Z'));

    mockGetUserFromRequest.mockResolvedValue({
      userId: 6,
      employeeId: 60,
      role: 'HR',
      username: 'hr-user',
    } as never);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 6,
      role: 'HR',
      isActive: true,
      employee: {
        id: 60,
        employeeId: 'E060',
        name: 'HR User',
        department: '人資部',
        position: 'SPECIALIST',
      },
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/attendance/today-summary'));

    expect(response.status).toBe(200);
    expect(mockPrisma.attendanceRecord.findFirst).toHaveBeenCalledWith({
      where: {
        employeeId: 60,
        workDate: {
          gte: new Date('2026-04-07T16:00:00.000Z'),
          lt: new Date('2026-04-08T16:00:00.000Z'),
        },
      },
    });
    expect(mockPrisma.attendanceRecord.count).toHaveBeenCalledWith({
      where: {
        workDate: {
          gte: new Date('2026-04-07T16:00:00.000Z'),
          lt: new Date('2026-04-08T16:00:00.000Z'),
        },
        status: 'PRESENT',
      },
    });

    jest.useRealTimers();
  });
});