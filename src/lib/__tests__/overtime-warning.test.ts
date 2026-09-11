import { prisma } from '@/lib/database';
import { calculateOvertimeRequestsEligibility } from '@/lib/overtime-eligibility';
import {
  getEmployeeMonthlyOvertime,
  scanAllEmployeesOvertime,
} from '@/lib/overtime-warning';

jest.mock('@/lib/database', () => ({
  prisma: {
    overtimeRequest: { findMany: jest.fn() },
    employee: { findMany: jest.fn(), findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    notification: { create: jest.fn() },
  },
}));

jest.mock('@/lib/overtime-eligibility', () => ({
  calculateOvertimeRequestsEligibility: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  systemLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockPrisma = prisma as unknown as {
  overtimeRequest: { findMany: jest.Mock };
  employee: { findMany: jest.Mock };
};
const mockCalculateEligibility = calculateOvertimeRequestsEligibility as jest.MockedFunction<
  typeof calculateOvertimeRequestsEligibility
>;

describe('overtime warning effective-hour aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses actual eligible hours for a monthly employee total', async () => {
    const approved = [{
      id: 10,
      employeeId: 5,
      overtimeDate: new Date('2026-05-13T00:00:00.000Z'),
      totalHours: 2,
    }];
    mockPrisma.overtimeRequest.findMany.mockResolvedValue(approved);
    mockCalculateEligibility.mockResolvedValue({
      byRequestId: new Map(),
      byEmployeeDate: new Map([['5-2026-05-13', {
        employeeId: 5,
        workDate: '2026-05-13',
        requestIds: [10],
        effectiveHours: 0.2,
      }]]),
      totalEffectiveHours: 0.2,
    } as never);

    await expect(getEmployeeMonthlyOvertime(5, 2026, 5)).resolves.toBe(0.2);
    expect(mockCalculateEligibility).toHaveBeenCalledWith(approved);
  });

  it('scans employees with one batch overtime query instead of one query per employee', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      { id: 5, employeeId: 'E005', name: '甲', department: 'A' },
      { id: 6, employeeId: 'E006', name: '乙', department: 'B' },
    ]);
    mockPrisma.overtimeRequest.findMany.mockResolvedValue([]);
    mockCalculateEligibility.mockResolvedValue({
      byRequestId: new Map(),
      byEmployeeDate: new Map(),
      totalEffectiveHours: 0,
    } as never);

    const result = await scanAllEmployeesOvertime(2026, 5);

    expect(result.scannedEmployees).toBe(2);
    expect(mockPrisma.overtimeRequest.findMany).toHaveBeenCalledTimes(1);
  });
});
