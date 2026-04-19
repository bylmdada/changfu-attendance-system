const TAIWAN_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const TAIWAN_TIMEZONE = 'Asia/Taipei';

type TaiwanDateParts = {
  year: number;
  month: number;
  day: number;
};

type PensionContributionRateLookup = {
  findFirst: (args: {
    where: {
      employeeId: number;
      status: 'APPROVED';
      effectiveDate: {
        lt: Date;
      };
    };
    orderBy: Array<{ effectiveDate: 'desc' } | { createdAt: 'desc' } | { id: 'desc' }>;
    select: {
      requestedRate: true;
    };
  }) => Promise<{ requestedRate: number } | null>;
};

function getTaiwanDateParts(date: Date): TaiwanDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIWAN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('無法解析台灣時區日期');
  }

  return { year, month, day };
}

export function getTaiwanMonthStartUtc(year: number, month1Based: number): Date {
  return new Date(Date.UTC(year, month1Based - 1, 1) - TAIWAN_UTC_OFFSET_MS);
}

export function calculatePensionContributionEffectiveDate(applicationDate: Date): Date {
  const { year, month, day } = getTaiwanDateParts(applicationDate);
  const monthOffset = day <= 25 ? 1 : 2;
  return getTaiwanMonthStartUtc(year, month + monthOffset);
}

export function formatPensionContributionEffectiveDatePreview(applicationDate: Date): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TAIWAN_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(calculatePensionContributionEffectiveDate(applicationDate));
}

export async function getEffectivePensionContributionRate(
  lookup: PensionContributionRateLookup,
  employeeId: number,
  fallbackRate: number,
  effectiveBeforeExclusive: Date
): Promise<number> {
  const application = await lookup.findFirst({
    where: {
      employeeId,
      status: 'APPROVED',
      effectiveDate: {
        lt: effectiveBeforeExclusive,
      },
    },
    orderBy: [
      { effectiveDate: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    select: {
      requestedRate: true,
    },
  });

  return application?.requestedRate ?? fallbackRate;
}
