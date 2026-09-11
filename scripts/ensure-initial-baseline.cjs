const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const baseline = '20260101_initial_schema';
function sql(database, query) {
  return JSON.parse(execFileSync('sqlite3', ['-json', database, query], { encoding: 'utf8' }) || '[]');
}
function ensureBaseline(database, root = process.cwd()) {
  if (!fs.existsSync(database)) return;
  const tables = sql(database, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  if (tables.length === 0) return;
  if (!tables.some(table => table.name === '_prisma_migrations')) {
    throw new Error('Existing database has no migration history. Verify applied migrations on a backup before baselining.');
  }
  const applied = sql(database, "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL");
  if (applied.some(row => row.migration_name === baseline)) return;
  if (!applied.length) throw new Error('No successful migration history; refusing automatic baseline');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'changfu-baseline-'));
  try {
    const reference = path.join(temporary, 'baseline.db');
    execFileSync('sqlite3', [reference], { input: fs.readFileSync(path.join(root, 'prisma/migrations', baseline, 'migration.sql')) });
    for (const table of sql(reference, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) {
      const columns = new Map(sql(database, `PRAGMA table_info("${table.name}")`).map(column => [column.name, column]));
      for (const column of sql(reference, `PRAGMA table_info("${table.name}")`)) {
        const actual = columns.get(column.name);
        if (!actual || actual.type !== column.type || actual.notnull !== column.notnull || actual.pk !== column.pk) {
          throw new Error(`Baseline schema mismatch ${table.name}.${column.name}`);
        }
      }
    }
    execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'resolve', '--applied', baseline], {
      cwd: root, env: { ...process.env, DATABASE_URL: `file:${database}` }, stdio: 'inherit',
    });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { ensureBaseline };
if (require.main === module) {
  try { ensureBaseline(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
