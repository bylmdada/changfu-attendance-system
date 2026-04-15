import path from 'path';

export const DEFAULT_REPAIR_DATABASE_URL = 'file:./prisma/dev.db';

export type RepairDatabaseTarget = {
  source: 'arg' | 'env' | 'fallback';
  databaseUrl: string;
  isSqlite: boolean;
  resolvedPath: string | null;
};

export type RepairDatabaseFileState = {
  exists: boolean;
  sizeBytes: number | null;
};

type ResolveRepairDatabaseTargetOptions = {
  envDatabaseUrl?: string;
  fallbackUrl?: string;
  preferArgSource?: boolean;
};

function normalizeDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    return undefined;
  }

  if (databaseUrl.startsWith('file:')) {
    return databaseUrl;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(databaseUrl)) {
    return databaseUrl;
  }

  return `file:${databaseUrl}`;
}

function stripSqliteUrlSuffix(databaseUrl: string) {
  return databaseUrl.split('?')[0].split('#')[0];
}

function resolveSqlitePath(databaseUrl: string, cwd: string) {
  if (!databaseUrl.startsWith('file:')) {
    return null;
  }

  let filePath = stripSqliteUrlSuffix(databaseUrl).slice(5);

  if (!filePath) {
    return null;
  }

  if (filePath.startsWith('//')) {
    filePath = filePath.replace(/^\/\/+/, '/');
  }

  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }

  return path.resolve(cwd, filePath);
}

export function resolveRepairDatabaseTarget(
  databaseUrl: string | undefined,
  cwd: string,
  options: string | ResolveRepairDatabaseTargetOptions = DEFAULT_REPAIR_DATABASE_URL
): RepairDatabaseTarget {
  const normalizedOptions = typeof options === 'string'
    ? { fallbackUrl: options }
    : options;
  const fallbackUrl = normalizedOptions.fallbackUrl ?? DEFAULT_REPAIR_DATABASE_URL;
  const normalizedDatabaseUrl = normalizeDatabaseUrl(databaseUrl);
  const normalizedEnvDatabaseUrl = normalizeDatabaseUrl(normalizedOptions.envDatabaseUrl);
  const source = normalizedDatabaseUrl
    ? (normalizedOptions.preferArgSource || (normalizedEnvDatabaseUrl !== undefined && normalizedDatabaseUrl !== normalizedEnvDatabaseUrl)
      ? 'arg'
      : 'env')
    : 'fallback';
  const effectiveUrl = normalizedDatabaseUrl || fallbackUrl;
  const resolvedPath = resolveSqlitePath(effectiveUrl, cwd);

  return {
    source,
    databaseUrl: effectiveUrl,
    isSqlite: effectiveUrl.startsWith('file:'),
    resolvedPath,
  };
}

function getErrorCode(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '');
  }

  return '';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '未知錯誤';
}

export function formatRepairDatabaseError(
  error: unknown,
  target: RepairDatabaseTarget,
  fileState?: RepairDatabaseFileState
) {
  const details: string[] = [];
  const targetLabel = target.resolvedPath ?? target.databaseUrl;
  const sourceLabel = target.source === 'arg'
    ? '命令列參數'
    : target.source === 'env'
      ? 'DATABASE_URL'
      : 'fallback';
  const errorCode = getErrorCode(error);
  const rawMessage = getErrorMessage(error);

  details.push(`資料庫目標: ${targetLabel} (${sourceLabel})`);

  if (fileState?.exists === false) {
    details.push('目前資料庫檔案不存在，請確認 --database、DATABASE_URL 或檔案路徑。');
    return details.join('\n');
  }

  if (fileState?.exists && fileState.sizeBytes === 0) {
    details.push('目前資料庫檔案是空的，這不是可用的考勤系統資料庫。');
    return details.join('\n');
  }

  if (errorCode === 'P2021' || rawMessage.includes('comp_leave_transactions')) {
    details.push('目標資料庫缺少補休交易資料表 comp_leave_transactions，請確認你連到的是正確的考勤系統資料庫。');
    return details.join('\n');
  }

  if (rawMessage.includes('Unable to open the database file')) {
    details.push('無法開啟資料庫檔案，請確認路徑存在且目前程序有讀取權限。');
    return details.join('\n');
  }

  details.push(rawMessage);
  return details.join('\n');
}