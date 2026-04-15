import { formatRepairDatabaseError, resolveRepairDatabaseTarget } from '@/lib/repair-database-target';

describe('resolveRepairDatabaseTarget', () => {
  it('uses the fallback sqlite URL when DATABASE_URL is unset', () => {
    const target = resolveRepairDatabaseTarget(undefined, '/workspace/app');

    expect(target.source).toBe('fallback');
    expect(target.databaseUrl).toBe('file:./prisma/dev.db');
    expect(target.isSqlite).toBe(true);
    expect(target.resolvedPath).toBe('/workspace/app/prisma/dev.db');
  });

  it('resolves an absolute sqlite file URL without rewriting it', () => {
    const target = resolveRepairDatabaseTarget('file:/var/data/prod.db', '/workspace/app');

    expect(target.source).toBe('env');
    expect(target.databaseUrl).toBe('file:/var/data/prod.db');
    expect(target.isSqlite).toBe(true);
    expect(target.resolvedPath).toBe('/var/data/prod.db');
  });

  it('prefers an explicitly supplied database URL over DATABASE_URL', () => {
    const target = resolveRepairDatabaseTarget('file:/cli/selected.db', '/workspace/app', {
      envDatabaseUrl: 'file:/env/original.db',
    });

    expect(target.source).toBe('arg');
    expect(target.databaseUrl).toBe('file:/cli/selected.db');
    expect(target.resolvedPath).toBe('/cli/selected.db');
  });

  it('normalizes a raw sqlite file path supplied from the command line', () => {
    const target = resolveRepairDatabaseTarget('./data/database.db', '/workspace/app', {
      envDatabaseUrl: 'file:/env/original.db',
    });

    expect(target.source).toBe('arg');
    expect(target.databaseUrl).toBe('file:./data/database.db');
    expect(target.resolvedPath).toBe('/workspace/app/data/database.db');
  });
});

describe('formatRepairDatabaseError', () => {
  it('explains when the sqlite file exists but is empty', () => {
    const target = resolveRepairDatabaseTarget('file:/workspace/app/prisma/prod.db', '/workspace/app');

    const message = formatRepairDatabaseError(
      new Error('The table `main.comp_leave_transactions` does not exist in the current database.'),
      target,
      { exists: true, sizeBytes: 0 }
    );

    expect(message).toContain('目前資料庫檔案是空的');
    expect(message).toContain('/workspace/app/prisma/prod.db');
  });

  it('explains when the target database is missing the expected table', () => {
    const target = resolveRepairDatabaseTarget('file:/workspace/app/data/database.db', '/workspace/app');

    const message = formatRepairDatabaseError(
      { code: 'P2021', message: 'The table `main.comp_leave_transactions` does not exist in the current database.' },
      target,
      { exists: true, sizeBytes: 4096 }
    );

    expect(message).toContain('缺少補休交易資料表');
    expect(message).toContain('/workspace/app/data/database.db');
  });

  it('labels command-line supplied targets clearly in error output', () => {
    const target = resolveRepairDatabaseTarget('file:/workspace/app/data/database.db', '/workspace/app', {
      envDatabaseUrl: 'file:/workspace/app/prisma/dev.db',
    });

    const message = formatRepairDatabaseError(
      new Error('SQLite database file not found'),
      target,
      { exists: false, sizeBytes: null }
    );

    expect(message).toContain('命令列參數');
    expect(message).toContain('/workspace/app/data/database.db');
  });
});