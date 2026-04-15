export type RepairCompLeaveScriptOptions = {
  apply: boolean;
  employeeId: number | null;
  databaseUrl?: string;
  confirm?: string;
  json: boolean;
  help: boolean;
};

export const FULL_APPLY_CONFIRMATION_TOKEN = 'REPAIR_ALL_IMPORT_BASELINES';

const USAGE_LINES = [
  '用法: npm run repair:comp-leave-imports -- [options]',
  '',
  '選項:',
  '  --apply                實際刪除舊 IMPORT baseline 並重算 balance',
  '  --employeeId=<id>      只處理單一員工',
  '  --database=<path|url>  指定 SQLite 路徑或 DATABASE_URL',
  `  --confirm=${FULL_APPLY_CONFIRMATION_TOKEN}  全庫 apply 前的額外確認`,
  '  --json                 以 JSON 輸出 dry-run 結果',
  '  --help, -h             顯示這份說明',
];

export function getRepairCompLeaveUsage(): string {
  return USAGE_LINES.join('\n');
}

export function parseRepairCompLeaveArgs(argv: string[]): RepairCompLeaveScriptOptions {
  const help = argv.includes('--help') || argv.includes('-h');

  if (help) {
    return {
      apply: false,
      employeeId: null,
      json: false,
      help: true,
    };
  }

  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const employeeArg = argv.find(arg => arg.startsWith('--employeeId='));
  const databaseArg = argv.find(arg => arg.startsWith('--database='));
  const confirmArg = argv.find(arg => arg.startsWith('--confirm='));
  const employeeId = employeeArg ? Number(employeeArg.split('=')[1]) : null;
  const databaseUrl = databaseArg?.split('=').slice(1).join('=').trim();
  const confirm = confirmArg?.split('=').slice(1).join('=').trim();

  if (employeeArg && Number.isNaN(employeeId)) {
    throw new Error('employeeId 必須是數字');
  }

  if (databaseArg && !databaseUrl) {
    throw new Error('database 參數不可為空');
  }

  if (confirmArg && !confirm) {
    throw new Error('confirm 參數不可為空');
  }

  return {
    apply,
    employeeId,
    databaseUrl,
    confirm,
    json,
    help: false,
  };
}

export function validateRepairCompLeaveOptions(options: RepairCompLeaveScriptOptions): void {
  if (options.apply && options.json) {
    throw new Error('--json 只支援 dry-run 模式');
  }

  if (!options.apply || options.help) {
    return;
  }

  if (options.employeeId !== null) {
    return;
  }

  if (options.confirm !== FULL_APPLY_CONFIRMATION_TOKEN) {
    throw new Error(`全庫修復必須加上 --confirm=${FULL_APPLY_CONFIRMATION_TOKEN}`);
  }
}