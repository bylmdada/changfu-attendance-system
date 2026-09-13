// Real SQLite regression: isolated schema, concurrent task creation and rollback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const ts = require('typescript');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'changfu-sentry-'));
  const database = path.join(temporary, 'test.db');
  const root = path.resolve(__dirname, '..');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${database}?connection_limit=2` } } });
  try {
    execFileSync('python3', ['-c', `import sqlite3,pathlib,sys
c=sqlite3.connect(sys.argv[1])
for p in sorted(pathlib.Path(sys.argv[2]).glob('*/migration.sql')): c.executescript(p.read_text())
c.close()`, database, path.join(root, 'prisma/migrations')]);
    function load(file, dependencies = require) {
      const exports = {};
      const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      vm.runInNewContext(code, { exports, require: dependencies, Date, console });
      return exports;
    }
    const utils = load('src/lib/property-maintenance-utils.ts');
    const { ensureImmediateMaintenanceTasks } = load('src/lib/property-due-task-service.ts', name => {
      if (name === '@/lib/database') return { prisma };
      if (name === '@/lib/property-maintenance-utils') return utils;
      return require(name);
    });
    const site = await prisma.propertySite.create({ data: { name: 'Test', code: 'TEST', institutionTitle: 'Test' } });
    const now = new Date('2026-09-13T00:00:00Z');
    const due = utils.startOfDay(now);
    const asset = await prisma.propertyAsset.create({ data: {
      siteId: site.id, name: 'Concurrent', assetCode: 'CONCURRENT', frequencyDays: 7,
    } });
    const results = await Promise.all(Array.from({ length: 24 }, () =>
      ensureImmediateMaintenanceTasks({ now, where: { id: asset.id } })
    ));
    assert.equal(results.reduce((sum, result) => sum + result.created, 0), 1);
    assert.equal(await prisma.maintenanceRecord.count({ where: { assetId: asset.id } }), 1);
    let updated = await prisma.propertyAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(updated.nextMaintenanceDate.toISOString(), utils.addDays(due, 7).toISOString());

    // A pending task blocks further advancement even when the asset is overdue again.
    await prisma.propertyAsset.update({ where: { id: asset.id }, data: { nextMaintenanceDate: due } });
    assert.equal((await ensureImmediateMaintenanceTasks({ now, where: { id: asset.id } })).created, 0);
    updated = await prisma.propertyAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(updated.nextMaintenanceDate.toISOString(), due.toISOString());

    const rollback = await prisma.propertyAsset.create({ data: {
      siteId: site.id, name: 'Rollback', assetCode: 'ROLLBACK', frequencyDays: 7,
    } });
    const collision = await prisma.maintenanceRecord.create({ data: {
      siteId: site.id, assetId: asset.id, assetCode: asset.assetCode,
      recordId: utils.buildRecordId(rollback.assetCode, due), status: 'DONE',
    } });
    assert.equal((await ensureImmediateMaintenanceTasks({ now, where: { id: rollback.id } })).created, 0);
    assert.equal((await prisma.propertyAsset.findUniqueOrThrow({ where: { id: rollback.id } })).nextMaintenanceDate, null);
    assert.equal(await prisma.maintenanceRecord.count({ where: { assetId: rollback.id } }), 0);
    await prisma.maintenanceRecord.delete({ where: { id: collision.id } });
    assert.equal((await ensureImmediateMaintenanceTasks({ now, where: { id: rollback.id } })).created, 1);
    console.log('PASS: 24 concurrent maintenance requests, pending-task guard, atomic rollback and retry');
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
