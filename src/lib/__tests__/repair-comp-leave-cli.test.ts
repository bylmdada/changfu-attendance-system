import {
  FULL_APPLY_CONFIRMATION_TOKEN,
  getRepairCompLeaveUsage,
  parseRepairCompLeaveArgs,
  validateRepairCompLeaveOptions,
} from '@/lib/repair-comp-leave-cli';

describe('parseRepairCompLeaveArgs', () => {
  it('returns help mode for --help without requiring other args to parse', () => {
    expect(parseRepairCompLeaveArgs(['--help'])).toEqual({
      apply: false,
      employeeId: null,
      json: false,
      help: true,
    });
  });

  it('parses apply, employeeId, and database override together', () => {
    expect(parseRepairCompLeaveArgs(['--apply', '--employeeId=42', '--database=./prisma/dev.db'])).toEqual({
      apply: true,
      employeeId: 42,
      databaseUrl: './prisma/dev.db',
      confirm: undefined,
      json: false,
      help: false,
    });
  });

  it('parses an explicit full-apply confirmation token', () => {
    expect(parseRepairCompLeaveArgs([
      '--apply',
      `--confirm=${FULL_APPLY_CONFIRMATION_TOKEN}`,
    ])).toEqual({
      apply: true,
      employeeId: null,
      databaseUrl: undefined,
      confirm: FULL_APPLY_CONFIRMATION_TOKEN,
      json: false,
      help: false,
    });
  });

  it('parses dry-run json mode', () => {
    expect(parseRepairCompLeaveArgs(['--json', '--employeeId=42'])).toEqual({
      apply: false,
      employeeId: 42,
      databaseUrl: undefined,
      confirm: undefined,
      json: true,
      help: false,
    });
  });

  it('rejects an empty database override', () => {
    expect(() => parseRepairCompLeaveArgs(['--database='])).toThrow('database 參數不可為空');
  });
});

describe('validateRepairCompLeaveOptions', () => {
  it('rejects full-database apply without the explicit confirmation token', () => {
    expect(() => validateRepairCompLeaveOptions(parseRepairCompLeaveArgs(['--apply']))).toThrow(
      `全庫修復必須加上 --confirm=${FULL_APPLY_CONFIRMATION_TOKEN}`
    );
  });

  it('allows single-employee apply without extra confirmation', () => {
    expect(() => validateRepairCompLeaveOptions(
      parseRepairCompLeaveArgs(['--apply', '--employeeId=42'])
    )).not.toThrow();
  });

  it('allows full-database apply when the confirmation token matches', () => {
    expect(() => validateRepairCompLeaveOptions(
      parseRepairCompLeaveArgs(['--apply', `--confirm=${FULL_APPLY_CONFIRMATION_TOKEN}`])
    )).not.toThrow();
  });

  it('rejects combining --json with --apply', () => {
    expect(() => validateRepairCompLeaveOptions(
      parseRepairCompLeaveArgs(['--apply', '--json', `--confirm=${FULL_APPLY_CONFIRMATION_TOKEN}`])
    )).toThrow('--json 只支援 dry-run 模式');
  });
});

describe('getRepairCompLeaveUsage', () => {
  it('documents the supported repair CLI options', () => {
    const usage = getRepairCompLeaveUsage();

    expect(usage).toContain('用法: npm run repair:comp-leave-imports -- [options]');
    expect(usage).toContain('--apply');
    expect(usage).toContain('--employeeId=<id>');
    expect(usage).toContain('--database=<path|url>');
    expect(usage).toContain('--confirm=REPAIR_ALL_IMPORT_BASELINES');
    expect(usage).toContain('--json');
    expect(usage).toContain('--help, -h');
  });
});