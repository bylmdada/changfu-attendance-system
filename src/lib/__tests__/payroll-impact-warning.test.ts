import { getPayrollImpactWarning } from '@/lib/payroll-impact-warning';

describe('payroll impact warning', () => {
  it('warns when the affected payroll month already exists', async () => {
    const client = {
      payrollRecord: {
        findMany: jest.fn().mockResolvedValue([
          { payYear: 2026, payMonth: 7 },
        ]),
      },
    };

    const warning = await getPayrollImpactWarning(client as never, {
      employeeId: 10,
      startDate: new Date('2026-07-08T00:00:00.000Z'),
      endDate: new Date('2026-07-09T00:00:00.000Z'),
    });

    expect(client.payrollRecord.findMany).toHaveBeenCalledWith({
      where: {
        employeeId: 10,
        OR: [{ payYear: 2026, payMonth: 7 }],
      },
      select: {
        payYear: true,
        payMonth: true,
      },
    });
    expect(warning).toContain('2026/07');
  });
});
