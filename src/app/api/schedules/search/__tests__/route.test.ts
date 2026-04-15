jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/database', () => ({
  prisma: {
    schedule: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/schedule-management-permissions', () => ({
  getManageableDepartments: jest.fn(),
  hasFullScheduleManagementAccess: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import {
  getManageableDepartments,
  hasFullScheduleManagementAccess,
} from '@/lib/schedule-management-permissions';
import { GET } from '../route';

const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetManageableDepartments = getManageableDepartments as jest.MockedFunction<typeof getManageableDepartments>;
const mockHasFullAccess = hasFullScheduleManagementAccess as jest.MockedFunction<typeof hasFullScheduleManagementAccess>;

describe('schedule search route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 31,
      role: 'ADMIN',
      username: 'scheduler',
    } as never);
    mockHasFullAccess.mockReturnValue(true);
    mockGetManageableDepartments.mockResolvedValue([] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
  });

  it('rejects malformed yearMonth before querying Prisma', async () => {
    const request = new NextRequest('http://localhost/api/schedules/search?yearMonth=2026-13abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('yearMonth 格式錯誤');
    expect(mockPrisma.schedule.findMany).not.toHaveBeenCalled();
  });
});