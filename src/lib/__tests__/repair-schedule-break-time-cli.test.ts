import {
  DEFAULT_SCHEDULE_BREAK_TIME_SHIFT_TYPES,
  FULL_APPLY_SCHEDULE_BREAK_TIME_CONFIRMATION_TOKEN,
  getRepairScheduleBreakTimeUsage,
  parseRepairScheduleBreakTimeArgs,
  validateRepairScheduleBreakTimeOptions,
} from '@/lib/repair-schedule-break-time-cli';

describe('parseRepairScheduleBreakTimeArgs', () => {
  it('returns help mode for --help without parsing other args', () => {
    expect(parseRepairScheduleBreakTimeArgs(['--help'])).toEqual({
      apply: false,
      employeeId: null,
      json: false,
      help: true,
      shiftTypes: [...DEFAULT_SCHEDULE_BREAK_TIME_SHIFT_TYPES],
      minutes: null,
    });
  });

  it('parses scoped apply options together', () => {
    expect(parseRepairScheduleBreakTimeArgs([
      '--apply',
      '--employeeId=42',
      '--month=2026-04',
      '--database=./prisma/prod.db',
      '--shiftTypes=A,C',
      '--minutes=45',
    ])).toEqual({
      apply: true,
      employeeId: 42,
      databaseUrl: './prisma/prod.db',
      month: '2026-04',
      confirm: undefined,
      json: false,
      help: false,
      shiftTypes: ['A', 'C'],
      minutes: 45,
    });
  });

  it('parses an explicit full-apply confirmation token', () => {
    expect(parseRepairScheduleBreakTimeArgs([
      '--apply',
      `--confirm=${FULL_APPLY_SCHEDULE_BREAK_TIME_CONFIRMATION_TOKEN}`,
    ])).toEqual({
      apply: true,
      employeeId: null,
      databaseUrl: undefined,
      month: undefined,
      confirm: FULL_APPLY_SCHEDULE_BREAK_TIME_CONFIRMATION_TOKEN,
      json: false,
      help: false,
      shiftTypes: [...DEFAULT_SCHEDULE_BREAK_TIME_SHIFT_TYPES],
      minutes: null,
    });
  });

  it('rejects empty shiftTypes override', () => {
    expect(() => parseRepairScheduleBreakTimeArgs(['--shiftTypes='])).toThrow('shiftTypes 參數至少要有一個班別');
  });
});

describe('validateRepairScheduleBreakTimeOptions', () => {
  it('rejects malformed month filters', () => {
    expect(() => validateRepairScheduleBreakTimeOptions(
      parseRepairScheduleBreakTimeArgs(['--month=2026-4'])
    )).toThrow('month 參數格式必須是 YYYY-MM');
  });

  it('allows scoped apply without full confirmation token', () => {
    expect(() => validateRepairScheduleBreakTimeOptions(
      parseRepairScheduleBreakTimeArgs(['--apply', '--month=2026-04', '--minutes=60'])
    )).not.toThrow();
  });

  it('rejects full apply without explicit confirmation token', () => {
    expect(() => validateRepairScheduleBreakTimeOptions(
      parseRepairScheduleBreakTimeArgs(['--apply', '--minutes=60'])
    )).toThrow(`全庫修復必須加上 --confirm=${FULL_APPLY_SCHEDULE_BREAK_TIME_CONFIRMATION_TOKEN}`);
  });

  it('rejects apply without explicit minutes', () => {
    expect(() => validateRepairScheduleBreakTimeOptions(
      parseRepairScheduleBreakTimeArgs(['--apply', '--month=2026-04'])
    )).toThrow('apply 模式必須明確提供 --minutes，因為 breakTime 可能依實際班表而不同');
  });

  it('rejects combining --json with --apply', () => {
    expect(() => validateRepairScheduleBreakTimeOptions(
      parseRepairScheduleBreakTimeArgs(['--apply', '--json', '--month=2026-04'])
    )).toThrow('--json 只支援 dry-run 模式');
  });
});

describe('getRepairScheduleBreakTimeUsage', () => {
  it('documents the supported CLI options', () => {
    const usage = getRepairScheduleBreakTimeUsage();

    expect(usage).toContain('用法: npm run repair:schedule-break-times -- [options]');
    expect(usage).toContain('--apply');
    expect(usage).toContain('--employeeId=<id>');
    expect(usage).toContain('--month=<YYYY-MM>');
    expect(usage).toContain('--database=<path|url>');
    expect(usage).toContain('--shiftTypes=A,B,C');
    expect(usage).toContain('apply 時必填');
    expect(usage).toContain('--json');
  });
});