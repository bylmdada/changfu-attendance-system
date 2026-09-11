jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    systemSettings: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    attendanceRecord: {
      findMany: jest.fn(),
    },
    schedule: {
      findMany: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/database';
import {
  calculatePerfectAttendanceBonus,
  countPerfectAttendanceScheduleIssues,
} from '../perfect-attendance';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('perfect attendance late and early leave detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.systemSettings.findFirst.mockResolvedValue(null as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 1,
      department: '日照中心',
    } as never);
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([] as never);
  });

  it('counts late arrivals and early leaves from scheduled start and end times', () => {
    const result = countPerfectAttendanceScheduleIssues(
      [
        {
          workDate: new Date('2026-04-08T16:00:00.000Z'),
          clockInTime: new Date('2026-04-09T01:05:00.000Z'),
          clockOutTime: new Date('2026-04-09T08:30:00.000Z'),
        },
      ],
      [
        {
          workDate: '2026-04-09',
          shiftType: 'A',
          startTime: '09:00',
          endTime: '17:00',
        },
      ]
    );

    expect(result).toEqual({ lateCount: 1, earlyLeaveCount: 1 });
  });

  it('deducts perfect attendance bonus for late and early leave records', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([
      {
        workDate: new Date('2026-04-08T16:00:00.000Z'),
        clockInTime: new Date('2026-04-09T01:05:00.000Z'),
        clockOutTime: new Date('2026-04-09T08:30:00.000Z'),
        status: 'PRESENT',
      },
    ] as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        workDate: '2026-04-09',
        shiftType: 'A',
        startTime: '09:00',
        endTime: '17:00',
      },
    ] as never);

    const result = await calculatePerfectAttendanceBonus(1, 2026, 4);

    expect(result.lateCount).toBe(1);
    expect(result.earlyLeaveCount).toBe(1);
    expect(result.workDays).toBe(1);
    expect(result.actualWorkDays).toBe(0);
    expect(result.actualAmount).toBe(0);
    expect(result.details).toContain('遲到1次');
    expect(result.details).toContain('早退1次');
  });

  it('derives absence from scheduled workdays without attendance records', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        workDate: '2026-04-09',
        shiftType: 'A',
        startTime: '09:00',
        endTime: '17:00',
      },
    ] as never);

    const result = await calculatePerfectAttendanceBonus(1, 2026, 4);

    expect(result.workDays).toBe(1);
    expect(result.absentCount).toBe(1);
    expect(result.actualAmount).toBe(0);
  });

  it('counts only the monthly overlap for cross-month affected leave', async () => {
    mockPrisma.schedule.findMany.mockResolvedValue([
      { workDate: '2026-07-01', shiftType: 'A', startTime: '09:00', endTime: '17:00' },
      { workDate: '2026-07-02', shiftType: 'A', startTime: '09:00', endTime: '17:00' },
      { workDate: '2026-07-03', shiftType: 'A', startTime: '09:00', endTime: '17:00' },
    ] as never);
    mockPrisma.leaveRequest.findMany.mockResolvedValue([
      {
        leaveType: 'PERSONAL',
        startDate: new Date('2026-06-28T00:00:00.000Z'),
        endDate: new Date('2026-07-03T00:00:00.000Z'),
        totalDays: 6,
      },
    ] as never);

    const result = await calculatePerfectAttendanceBonus(1, 2026, 7);

    expect(result.affectedLeavedays).toBe(3);
    expect(result.absentCount).toBe(0);
  });

  it('moves the late boundary to the end of an approved morning leave', () => {
    const result = countPerfectAttendanceScheduleIssues(
      [
        {
          workDate: new Date('2026-04-08T16:00:00.000Z'),
          clockInTime: new Date('2026-04-09T05:05:00.000Z'),
          clockOutTime: new Date('2026-04-09T09:00:00.000Z'),
        },
      ],
      [
        {
          workDate: '2026-04-09',
          shiftType: 'A',
          startTime: '09:00',
          endTime: '17:00',
        },
      ],
      [
        {
          startDate: new Date('2026-04-09T01:00:00.000Z'),
          endDate: new Date('2026-04-09T05:00:00.000Z'),
          totalDays: 0.5,
        },
      ]
    );

    expect(result.lateCount).toBe(1);
  });
});
