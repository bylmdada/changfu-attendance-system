import type { Prisma } from '@prisma/client';
import { getTaiwanDateParts } from '@/lib/timezone';

type PayrollWarningClient = Pick<Prisma.TransactionClient, 'payrollRecord'>;

function getMonthsBetween(startDate: Date, endDate: Date) {
  const start = getTaiwanDateParts(startDate);
  const end = getTaiwanDateParts(endDate);
  const months: Array<{ year: number; month: number }> = [];

  for (
    let year = start.year, month = start.month;
    year < end.year || (year === end.year && month <= end.month);
    month += 1
  ) {
    if (month > 12) {
      year += 1;
      month = 1;
    }
    months.push({ year, month });
  }

  return months;
}

export async function getPayrollImpactWarning(
  client: PayrollWarningClient,
  params: {
    employeeId: number;
    startDate: Date | string;
    endDate: Date | string;
  }
) {
  const startDate = new Date(params.startDate);
  const endDate = new Date(params.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  const months = getMonthsBetween(startDate, endDate);
  if (months.length === 0) return null;

  if (!client.payrollRecord?.findMany) return null;

  let records: Array<{ payYear: number; payMonth: number }>;
  try {
    records = await client.payrollRecord.findMany({
      where: {
        employeeId: params.employeeId,
        OR: months.map(({ year, month }) => ({ payYear: year, payMonth: month })),
      },
      select: {
        payYear: true,
        payMonth: true,
      },
    });
  } catch (error) {
    console.error('查詢薪資影響警示失敗:', error);
    return null;
  }
  if (records.length === 0) return null;

  const affectedMonths = records
    .map((record) => `${record.payYear}/${String(record.payMonth).padStart(2, '0')}`)
    .join('、');
  return `此申請影響的 ${affectedMonths} 薪資已產生，請薪資管理員人工處理差額`;
}
