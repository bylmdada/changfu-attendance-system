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
    // 模擬唯一鍵衝突（例如另一個請求剛好搶先寫入同一個紀錄ID）：整筆更新要一起回復，且之後可重試
    const collision = await prisma.maintenanceRecord.create({ data: {
      siteId: site.id, assetId: asset.id, assetCode: asset.assetCode,
      recordId: utils.buildRecordId(rollback.assetCode, due, rollback.id), status: 'DONE',
    } });
    assert.equal((await ensureImmediateMaintenanceTasks({ now, where: { id: rollback.id } })).created, 0);
    assert.equal((await prisma.propertyAsset.findUniqueOrThrow({ where: { id: rollback.id } })).nextMaintenanceDate, null);
    assert.equal(await prisma.maintenanceRecord.count({ where: { assetId: rollback.id } }), 0);
    await prisma.maintenanceRecord.delete({ where: { id: collision.id } });
    assert.equal((await ensureImmediateMaintenanceTasks({ now, where: { id: rollback.id } })).created, 1);

    // 兩個據點有同號資產、同日到期：各自都要有任務（紀錄ID 含資產 ID），重跑不再新增
    const siteB = await prisma.propertySite.create({ data: { name: 'Test B', code: 'TESTB', institutionTitle: 'Test B' } });
    const twinA = await prisma.propertyAsset.create({ data: { siteId: site.id, name: 'Twin A', assetCode: 'TWIN', frequencyDays: 7 } });
    const twinB = await prisma.propertyAsset.create({ data: { siteId: siteB.id, name: 'Twin B', assetCode: 'TWIN', frequencyDays: 7 } });
    assert.equal((await ensureImmediateMaintenanceTasks({ now, where: { assetCode: 'TWIN' } })).created, 2);
    const twinRecords = await prisma.maintenanceRecord.findMany({ where: { assetId: { in: [twinA.id, twinB.id] } } });
    assert.equal(twinRecords.length, 2);
    assert.equal(new Set(twinRecords.map(record => record.recordId)).size, 2);
    assert.equal((await ensureImmediateMaintenanceTasks({ now, where: { assetCode: 'TWIN' } })).created, 0);
    assert.equal(await prisma.maintenanceRecord.count({ where: { assetId: { in: [twinA.id, twinB.id] } } }), 2);

    // 舊版（只含日期＋財產編號）已為同一資產、同一天產生過任務：不可再重複產生一筆
    const legacy = await prisma.propertyAsset.create({ data: { siteId: site.id, name: 'Legacy', assetCode: 'LEGACY', frequencyDays: 7 } });
    await prisma.maintenanceRecord.create({ data: {
      siteId: site.id, assetId: legacy.id, assetCode: legacy.assetCode,
      recordId: utils.buildLegacyRecordId(legacy.assetCode, due), status: 'DONE',
    } });
    assert.equal((await ensureImmediateMaintenanceTasks({ now, where: { id: legacy.id } })).created, 0);
    assert.equal(await prisma.maintenanceRecord.count({ where: { assetId: legacy.id } }), 1);

    // 定時排程（週三產生任務）走另一條路徑，同樣要處理同號資產與舊格式去重
    const { generateMaintenanceTasks } = load('src/lib/property-cron-service.ts', name => {
      if (name === '@/lib/database') return { prisma };
      if (name === '@/lib/property-maintenance-utils') return utils;
      if (name === '@/lib/email') return { sendNotification: async () => {} };
      if (name === '@/lib/app-config') return { resolveSiteConfig: () => ({}), APP_CONFIG: {} };
      if (name === '@/lib/logger') return { systemLogger: { error() {}, warn() {}, info() {} } };
      return require(name);
    });
    const cronC = await prisma.propertySite.create({ data: { name: 'Cron C', code: 'CRONC', institutionTitle: 'Cron C' } });
    const cronD = await prisma.propertySite.create({ data: { name: 'Cron D', code: 'CROND', institutionTitle: 'Cron D' } });
    const cronAssets = await Promise.all([cronC, cronD].map(cronSite => prisma.propertyAsset.create({ data: {
      siteId: cronSite.id, name: 'Cron twin', assetCode: 'CRONTWIN', frequencyDays: 7, nextMaintenanceDate: due,
    } })));
    const cronLegacy = await prisma.propertyAsset.create({ data: {
      siteId: cronC.id, name: 'Cron legacy', assetCode: 'CRONLEGACY', frequencyDays: 7, nextMaintenanceDate: due,
    } });
    await prisma.maintenanceRecord.create({ data: {
      siteId: cronC.id, assetId: cronLegacy.id, assetCode: cronLegacy.assetCode,
      recordId: utils.buildLegacyRecordId(cronLegacy.assetCode, due), status: 'DONE',
    } });
    const firstRun = await generateMaintenanceTasks(now);
    assert.equal(firstRun.summary['Cron C'].created, 1);
    assert.equal(firstRun.summary['Cron D'].created, 1);
    assert.equal(await prisma.maintenanceRecord.count({ where: { assetId: { in: cronAssets.map(a => a.id) } } }), 2);
    assert.equal(await prisma.maintenanceRecord.count({ where: { assetId: cronLegacy.id } }), 1);
    const secondRun = await generateMaintenanceTasks(now);
    assert.equal(secondRun.summary['Cron C'].created, 0);
    assert.equal(secondRun.summary['Cron D'].created, 0);
    assert.equal(await prisma.maintenanceRecord.count({ where: { assetId: { in: cronAssets.map(a => a.id) } } }), 2);

    // 匯入：紀錄ID 是全系統唯一鍵，已屬於別的據點時不可被默默搬走，並回報 Excel 列號
    const XLSX = require('xlsx');
    const appConfig = load('src/lib/app-config.ts');
    const auditStatus = load('src/lib/property-audit-status.ts');
    const attachmentPaths = load('src/lib/property-attachment-paths.ts');
    const { importPropertyWorkbook } = load('src/lib/property-import-service.ts', name => {
      if (name === '@/lib/database') return { prisma };
      if (name === '@/lib/app-config') return appConfig;
      if (name === '@/lib/property-site-service') return { findExistingDefaultPropertySite: async () => null, getOrCreateDefaultPropertySite: async () => { throw new Error('unused'); } };
      if (name === '@/lib/property-maintenance-utils') return utils;
      if (name === '@/lib/property-attachment-paths') return attachmentPaths;
      if (name === '@/lib/property-barcode') return { isCode128Compatible: text => /^[\x20-\x7E]{1,80}$/.test(text) };
      if (name === '@/lib/property-audit-status') return auditStatus;
      return require(name);
    });
    const importSiteA = await prisma.propertySite.create({ data: { name: 'Import A', code: 'IMPA', institutionTitle: 'Import A' } });
    const importSiteB = await prisma.propertySite.create({ data: { name: 'Import B', code: 'IMPB', institutionTitle: 'Import B' } });
    const ownerAsset = await prisma.propertyAsset.create({ data: { siteId: importSiteB.id, name: 'Owner', assetCode: 'IMP1' } });
    await prisma.maintenanceRecord.create({ data: {
      siteId: importSiteB.id, assetId: ownerAsset.id, assetCode: 'IMP1', recordId: 'REC-SHARED', status: 'DONE',
    } });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['財產編號', '財產名稱'],
      ['IMP1', 'Imp one'],
    ]), '財產主檔');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['紀錄ID', '財產編號', '應維護日期', '維護狀態'],
      ['REC-SHARED', 'IMP1', '2026-11-01', '已完成'],
      [],
      ['REC-OK', 'IMP1', '2026-11-02', '已完成'],
    ]), '維護執行紀錄');
    const workbookBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const importOptions = { siteId: importSiteA.id, defaultSiteName: 'x', defaultSiteCode: 'X', institutionTitle: 'x' };

    const firstImport = await importPropertyWorkbook(workbookBytes, importOptions);
    assert.equal(firstImport.results.records.skippedConflict, 1);
    assert.equal(firstImport.results.records.created, 1);
    const conflictNote = firstImport.errors.find(message => message.includes('REC-SHARED'));
    assert.ok(conflictNote && conflictNote.includes('第 2 列') && conflictNote.includes('其他據點'), String(conflictNote));
    assert.ok(firstImport.message.includes('歸屬衝突略過 1'), firstImport.message);
    const shared = await prisma.maintenanceRecord.findUniqueOrThrow({ where: { recordId: 'REC-SHARED' } });
    assert.equal(shared.siteId, importSiteB.id);
    assert.equal(shared.assetId, ownerAsset.id);
    const imported = await prisma.maintenanceRecord.findUniqueOrThrow({ where: { recordId: 'REC-OK' } });
    assert.equal(imported.siteId, importSiteA.id);

    // 再匯入一次：本據點的紀錄是更新、衝突仍被擋下，空白列不影響列號
    const secondImport = await importPropertyWorkbook(workbookBytes, importOptions);
    assert.equal(secondImport.results.records.updated, 1);
    assert.equal(secondImport.results.records.created, 0);
    assert.equal(secondImport.results.records.skippedConflict, 1);
    assert.equal(secondImport.results.records.skippedNoId, 0);

    console.log('PASS: 24 concurrent maintenance requests, pending-task guard, atomic rollback and retry, same-code assets across sites, legacy record IDs, cron generation, import ownership conflicts');
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
