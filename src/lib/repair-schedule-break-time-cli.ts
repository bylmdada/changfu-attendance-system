export type RepairScheduleBreakTimeScriptOptions = {
  apply: boolean;
  employeeId: number | null;
  databaseUrl?: string;
  month?: string;
  confirm?: string;
  json: boolean;
  help: boolean;
  shiftTypes: string[];
  minutes: number | null;
};

export const DEFAULT_SCHEDULE_BREAK_TIME_SHIFT_TYPES = ['A', 'B', 'C'] as const;
export const FULL_APPLY_SCHEDULE_BREAK_TIME_CONFIRMATION_TOKEN = 'REPAIR_ALL_SCHEDULE_BREAK_TIMES';

const USAGE_LINES = [
  '用法: npm run repair:schedule-break-times -- [options]',
  '',
  '注意: breakTime 是每筆班表資料，不應單靠 A/B/C 班別代碼推定固定分鐘數。',
  '      apply 前請先確認資料來源，再明確傳入 --minutes。',
  '',
  '選項:',
  '  --apply                實際寫入 break_time',
  '  --employeeId=<id>      只處理單一員工',
  '  --month=<YYYY-MM>      只處理指定月份，例如 2026-04',
  '  --database=<path|url>  指定 SQLite 路徑或 DATABASE_URL',
  `  --confirm=${FULL_APPLY_SCHEDULE_BREAK_TIME_CONFIRMATION_TOKEN}  全庫 apply 前的額外確認`,
  `  --shiftTypes=${DEFAULT_SCHEDULE_BREAK_TIME_SHIFT_TYPES.join(',')}  指定要修復的班別`,
  '  --minutes=<number>     指定寫回的休息分鐘數（apply 時必填）',
  '  --json                 以 JSON 輸出 dry-run 結果',
  '  --help, -h             顯示這份說明',
];

export function getRepairScheduleBreakTimeUsage(): string {
  return USAGE_LINES.join('\n');
}

function parseIntegerOption(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} 必須是整數`);
  }

  return parsed;
}

export function parseRepairScheduleBreakTimeArgs(argv: string[]): RepairScheduleBreakTimeScriptOptions {
  const help = argv.includes('--help') || argv.includes('-h');

  if (help) {
    return {
      apply: false,
      employeeId: null,
      json: false,
      help: true,
      shiftTypes: [...DEFAULT_SCHEDULE_BREAK_TIME_SHIFT_TYPES],
      minutes: null,
    };
  }

  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const employeeArg = argv.find(arg => arg.startsWith('--employeeId='));
  const databaseArg = argv.find(arg => arg.startsWith('--database='));
  const monthArg = argv.find(arg => arg.startsWith('--month='));
  const confirmArg = argv.find(arg => arg.startsWith('--confirm='));
  const shiftTypesArg = argv.find(arg => arg.startsWith('--shiftTypes='));
  const minutesArg = argv.find(arg => arg.startsWith('--minutes='));

  const employeeId = employeeArg ? parseIntegerOption(employeeArg.split('=')[1], 'employeeId') : null;
  const databaseUrl = databaseArg?.split('=').slice(1).join('=').trim();
  const month = monthArg?.split('=').slice(1).join('=').trim();
  const confirm = confirmArg?.split('=').slice(1).join('=').trim();
  const shiftTypes = shiftTypesArg
    ? shiftTypesArg
        .split('=').slice(1).join('=')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    : [...DEFAULT_SCHEDULE_BREAK_TIME_SHIFT_TYPES];
  const minutes = minutesArg
    ? parseIntegerOption(minutesArg.split('=').slice(1).join('=').trim(), 'minutes')
    : null;

  if (databaseArg && !databaseUrl) {
    throw new Error('database 參數不可為空');
  }

  if (monthArg && !month) {
    throw new Error('month 參數不可為空');
  }

  if (confirmArg && !confirm) {
    throw new Error('confirm 參數不可為空');
  }

  if (shiftTypesArg && shiftTypes.length === 0) {
    throw new Error('shiftTypes 參數至少要有一個班別');
  }

  return {
    apply,
    employeeId,
    databaseUrl,
    month,
    confirm,
    json,
    help: false,
    shiftTypes,
    minutes,
  };
}

export function validateRepairScheduleBreakTimeOptions(options: RepairScheduleBreakTimeScriptOptions): void {
  if (options.json && options.apply) {
    throw new Error('--json 只支援 dry-run 模式');
  }

  if (options.month && !/^\d{4}-\d{2}$/.test(options.month)) {
    throw new Error('month 參數格式必須是 YYYY-MM');
  }

  if (options.employeeId !== null && options.employeeId <= 0) {
    throw new Error('employeeId 必須大於 0');
  }

  if (options.minutes !== null && options.minutes <= 0) {
    throw new Error('minutes 必須大於 0');
  }

  if (!options.apply || options.help) {
    return;
  }

  if (options.minutes === null) {
    throw new Error('apply 模式必須明確提供 --minutes，因為 breakTime 可能依實際班表而不同');
  }

  if (options.employeeId !== null || options.month) {
    return;
  }

  if (options.confirm !== FULL_APPLY_SCHEDULE_BREAK_TIME_CONFIRMATION_TOKEN) {
    throw new Error(`全庫修復必須加上 --confirm=${FULL_APPLY_SCHEDULE_BREAK_TIME_CONFIRMATION_TOKEN}`);
  }
}