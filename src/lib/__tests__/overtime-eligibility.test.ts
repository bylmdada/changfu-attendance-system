import { prisma } from '@/lib/database';
import { getStoredOvertimeCalculationSettings } from '@/lib/overtime-settings';
import {
  calculateOvertimeRequestEligibility,
  calculateOvertimeRequestsEligibility,
  getOvertimeEligibilityError,
} from '@/lib/overtime-eligibility';

jest.mock('@/lib/database', () => ({
  prisma: {
    attendanceRecord: { findFirst: jest.fn(), findMany: jest.fn() },
    schedule: { findFirst: jest.fn(), findMany: jest.fn() },
    holiday: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('@/lib/overtime-settings', () => ({
  getStoredOvertimeCalculationSettings: jest.fn(),
}));

const mockPrisma = prisma as unknown as {
  attendanceRecord: { findFirst: jest.Mock; findMany: jest.Mock };
  schedule: { findFirst: jest.Mock; findMany: jest.Mock };
  holiday: { findFirst: jest.Mock; findMany: jest.Mock };
};
const mockedGetSettings = getStoredOvertimeCalculationSettings as jest.MockedFunction<
  typeof getStoredOvertimeCalculationSettings
>;

const request = {
  id: 10,
  employeeId: 100,
  overtimeDate: new Date('2026-07-17T00:00:00.000Z'),
  totalHours: 1,
  compensationType: 'OVERTIME_PAY',
};

describe('overtime request eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSettings.mockResolvedValue({ overtimeMinUnit: 30 } as never);
    mockPrisma.schedule.findFirst.mockResolvedValue({
      workDate: '2026-07-17',
      shiftType: 'B',
      startTime: '08:00',
      endTime: '17:00',
      breakTime: 60,
      workHours: 8,
    });
    mockPrisma.holiday.findFirst.mockResolvedValue(null);
  });

  it('does not recognize overtime when one late hour plus one extended hour totals eight hours', async () => {
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 1,
      employeeId: 100,
      workDate: new Date('2026-07-16T16:00:00.000Z'),
      clockInTime: new Date('2026-07-17T01:00:00.000Z'),
      clockOutTime: new Date('2026-07-17T10:00:00.000Z'),
      regularHours: 7,
      overtimeHours: 1,
    });

    const result = await calculateOvertimeRequestEligibility(request);

    expect(result.hasCompleteAttendance).toBe(true);
    expect(result.regularHours).toBe(8);
    expect(result.effectiveHours).toBe(0);
    expect(getOvertimeEligibilityError(result)).toContain('未達法定加班門檻');
  });

  it('does not allow a submitted overtime type to override an existing weekday schedule', async () => {
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 1,
      employeeId: 100,
      workDate: new Date('2026-07-16T16:00:00.000Z'),
      clockInTime: new Date('2026-07-17T01:00:00.000Z'),
      clockOutTime: new Date('2026-07-17T10:00:00.000Z'),
      regularHours: 7,
      overtimeHours: 1,
    });

    const result = await calculateOvertimeRequestEligibility(request, {
      overtimeType: 'REST_DAY',
    });

    expect(result.overtimeType).toBe('WEEKDAY');
    expect(result.effectiveHours).toBe(0);
  });

  it('recognizes only the portion above eight actual net hours', async () => {
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 1,
      employeeId: 100,
      workDate: new Date('2026-07-16T16:00:00.000Z'),
      clockInTime: new Date('2026-07-17T00:00:00.000Z'),
      clockOutTime: new Date('2026-07-17T10:00:00.000Z'),
      regularHours: 8,
      overtimeHours: 0,
    });

    const result = await calculateOvertimeRequestEligibility(request);

    expect(result.regularHours).toBe(8);
    expect(result.effectiveHours).toBe(1);
    expect(result.payableHours).toBe(1);
    expect(getOvertimeEligibilityError(result)).toBeNull();
  });

  it('requires complete clock records before final approval', async () => {
    mockPrisma.attendanceRecord.findFirst.mockResolvedValue({
      id: 1,
      employeeId: 100,
      workDate: new Date('2026-07-16T16:00:00.000Z'),
      clockInTime: new Date('2026-07-17T00:00:00.000Z'),
      clockOutTime: null,
    });

    const result = await calculateOvertimeRequestEligibility(request);

    expect(result.hasCompleteAttendance).toBe(false);
    expect(result.effectiveHours).toBe(0);
    expect(getOvertimeEligibilityError(result)).toContain('請先完成補卡');
  });

  it('batch-resolves approved requests from actual attendance without losing worked minutes', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([{
      id: 1,
      employeeId: 100,
      workDate: new Date('2026-07-16T16:00:00.000Z'),
      clockInTime: new Date('2026-07-17T00:00:00.000Z'),
      clockOutTime: new Date('2026-07-17T09:12:00.000Z'),
      regularHours: 8,
      overtimeHours: 0.2,
    }]);
    mockPrisma.schedule.findMany.mockResolvedValue([{
      employeeId: 100,
      workDate: '2026-07-17',
      shiftType: 'B',
      startTime: '08:00',
      endTime: '17:00',
      breakTime: 60,
      workHours: 8,
    }]);
    mockPrisma.holiday.findMany.mockResolvedValue([]);

    const results = await calculateOvertimeRequestsEligibility([request], { unitMinutes: 60 });

    expect(results.byRequestId.get(request.id)).toMatchObject({
      hasCompleteAttendance: true,
      overtimeType: 'WEEKDAY',
      effectiveHours: 0.2,
      payableHours: 0.2,
    });
    expect(results.totalEffectiveHours).toBe(0.2);
  });

  it('counts same-day approved requests once after aggregating their request caps', async () => {
    mockPrisma.attendanceRecord.findMany.mockResolvedValue([{
      employeeId: 100,
      workDate: new Date('2026-07-16T16:00:00.000Z'),
      clockInTime: new Date('2026-07-17T00:00:00.000Z'),
      clockOutTime: new Date('2026-07-17T10:00:00.000Z'),
    }]);
    mockPrisma.schedule.findMany.mockResolvedValue([{
      employeeId: 100,
      workDate: '2026-07-17',
      shiftType: 'B',
      startTime: '08:00',
      endTime: '17:00',
      breakTime: 60,
      workHours: 8,
    }]);
    mockPrisma.holiday.findMany.mockResolvedValue([]);
    const secondRequest = { ...request, id: 11, totalHours: 0.51 };

    const results = await calculateOvertimeRequestsEligibility([
      { ...request, totalHours: 0.49 },
      secondRequest,
    ], { unitMinutes: 60 });

    expect(results.byEmployeeDate.size).toBe(1);
    expect(results.byRequestId.get(request.id)?.effectiveHours).toBe(1);
    expect(results.byRequestId.get(secondRequest.id)?.effectiveHours).toBe(1);
    expect(results.totalEffectiveHours).toBe(1);
  });
});
