jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      findUnique: jest.fn(),
    },
    schedule: {
      findMany: jest.fn(),
    },
    holiday: {
      findMany: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('payroll payslip route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    (mockPrisma as unknown as {
      systemSettings: { findUnique: jest.Mock };
    }).systemSettings.findUnique.mockResolvedValue(null as never);
  });

  it('rejects mixed payroll ids before querying prisma', async () => {
    const request = new NextRequest('http://localhost/api/payroll/payslip?payrollId=12abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('薪資記錄ID格式無效');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });

  it('returns schedule-aligned work hour summary for payslips', async () => {
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 1,
      employeeId: 1,
      payYear: 2026,
      payMonth: 5,
      regularHours: 24,
      overtimeHours: 5,
      weekdayOvertimeHours: 2,
      restDayOvertimeHours: 1,
      holidayOvertimeHours: 2,
      mandatoryRestOvertimeHours: 0,
      basePay: 32000,
      overtimePay: 1500,
      grossPay: 33500,
      laborInsurance: 700,
      healthInsurance: 500,
      supplementaryInsurance: 0,
      incomeTax: 300,
      totalDeductions: 1500,
      netPay: 32000,
      employee: {
        id: 1,
        employeeId: 'E001',
        name: '測試員工',
        department: '照護部',
        position: '照服員',
        baseSalary: 32000,
        hourlyRate: 200,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
      },
      adjustments: [],
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([
      {
        workDate: '2026-05-01',
        workHours: 8,
        specialLeaveHours: 2,
        compLeaveHours: 0,
        overtimeHours: 1,
      },
      {
        workDate: '2026-05-02',
        workHours: 8,
        specialLeaveHours: 0,
        compLeaveHours: 3,
        overtimeHours: 4,
      },
    ] as never);
    mockPrisma.holiday.findMany.mockResolvedValue([
      { date: new Date('2026-05-01T00:00:00.000Z') },
    ] as never);

    const request = new NextRequest('http://localhost/api/payroll/payslip?payrollId=1');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.payslip.workHours).toMatchObject({
      expectedWorkHours: 21,
      actualWorkHours: 24,
      specialLeaveHours: 2,
      compLeaveHours: 3,
      scheduledOvertimeHours: 5,
      nationalHolidayHours: 8,
      payrollRegularHours: 24,
      payrollOvertimeHours: 5,
      payrollTotalHours: 29,
      overtimeBreakdown: {
        weekday: 2,
        restDay: 1,
        holiday: 2,
        mandatoryRest: 0,
      },
    });
  });

  it('hides income tax item and adjusts displayed totals when withholding is disabled', async () => {
    (mockPrisma as unknown as {
      systemSettings: { findUnique: jest.Mock };
    }).systemSettings.findUnique.mockResolvedValue({
      key: 'income_tax_management_settings',
      value: JSON.stringify({ withholdingEnabled: false }),
    } as never);
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 2,
      employeeId: 1,
      payYear: 2026,
      payMonth: 5,
      regularHours: 160,
      overtimeHours: 0,
      basePay: 32000,
      overtimePay: 0,
      grossPay: 32000,
      laborInsurance: 700,
      healthInsurance: 500,
      supplementaryInsurance: 100,
      incomeTax: 300,
      totalDeductions: 1600,
      netPay: 30400,
      employee: {
        id: 1,
        employeeId: 'E001',
        name: '測試員工',
        department: '照護部',
        position: '照服員',
        baseSalary: 32000,
        hourlyRate: 200,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
      },
      adjustments: [],
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.holiday.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/payroll/payslip?payrollId=2');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.payslip.deductions).toEqual([
      expect.objectContaining({ code: 'LABOR_INSURANCE', amount: 700 }),
      expect.objectContaining({ code: 'HEALTH_INSURANCE', amount: 500 }),
      expect.objectContaining({ code: 'SUPPLEMENTARY_INSURANCE', amount: 100 }),
    ]);
    expect(payload.payslip.summary.totalDeductions).toBe(1300);
    expect(payload.payslip.summary.netPay).toBe(30700);
  });

  it('renders stored bonus details and split bonus supplementary insurance on payslips', async () => {
    mockPrisma.payrollRecord.findUnique.mockResolvedValue({
      id: 3,
      employeeId: 1,
      payYear: 2026,
      payMonth: 2,
      regularHours: 160,
      overtimeHours: 0,
      basePay: 32000,
      overtimePay: 0,
      grossPay: 77000,
      laborInsurance: 700,
      healthInsurance: 500,
      supplementaryInsurance: 421,
      incomeTax: 300,
      totalDeductions: 1921,
      netPay: 75079,
      deductionDetails: {
        bonusSupplementaryInsurance: 321,
        bonusDetails: [
          {
            bonusType: 'YEAR_END',
            bonusTypeName: '年終獎金',
            amount: 45000,
          },
        ],
      },
      employee: {
        id: 1,
        employeeId: 'E001',
        name: '測試員工',
        department: '照護部',
        position: '照服員',
        baseSalary: 32000,
        hourlyRate: 200,
        hireDate: new Date('2025-01-01T00:00:00.000Z'),
      },
      adjustments: [],
    } as never);
    mockPrisma.schedule.findMany.mockResolvedValue([] as never);
    mockPrisma.holiday.findMany.mockResolvedValue([] as never);

    const request = new NextRequest('http://localhost/api/payroll/payslip?payrollId=3');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.payslip.earnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BONUS_YEAR_END', name: '年終獎金', amount: 45000 }),
      ])
    );
    expect(payload.payslip.deductions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SUPPLEMENTARY_INSURANCE', amount: 100 }),
        expect.objectContaining({ code: 'BONUS_SUPPLEMENTARY_INSURANCE', amount: 321 }),
      ])
    );
  });
});
