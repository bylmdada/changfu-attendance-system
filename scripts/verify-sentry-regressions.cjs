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

    // 考勤顯示狀態快取的失效：改班、刪班、修改打卡時間都必須清掉已存的狀態（舊觸發器用 datetime(work_date) 比對，
    // 但 Prisma 存的是整數毫秒 → 永遠不成立，改班後狀態篩選會漏掉紀錄）；應用程式回填狀態本身不可觸發失效
    const taipeiMidnight = ymd => new Date(Date.parse(`${ymd}T00:00:00Z`) - 8 * 3600000);
    const newStaff = code => prisma.employee.create({ data: {
      employeeId: code, name: code, birthday: new Date('1990-01-01'), hireDate: new Date('2024-01-01'), baseSalary: 1, hourlyRate: 1,
    } });
    const staff = await newStaff('STAT1');
    const colleague = await newStaff('STAT2');
    const attendanceOn = (employeeId, ymd) => prisma.attendanceRecord.create({ data: {
      employeeId, workDate: taipeiMidnight(ymd),
      clockInTime: new Date(taipeiMidnight(ymd).getTime() + 8 * 3600000), clockOutTime: new Date(taipeiMidnight(ymd).getTime() + 17 * 3600000),
    } });
    const att20 = await attendanceOn(staff.id, '2026-11-20');
    const att21 = await attendanceOn(staff.id, '2026-11-21');
    const colleague20 = await attendanceOn(colleague.id, '2026-11-20');
    const statusOf = async id => (await prisma.attendanceRecord.findUniqueOrThrow({ where: { id } })).displayStatus;
    const materialize = () => prisma.attendanceRecord.updateMany({ data: { displayStatus: '正常' } });
    const scheduleOn = (employeeId, ymd) => prisma.schedule.create({ data: {
      employeeId, workDate: ymd, shiftType: 'A', startTime: '08:00', endTime: '17:00', breakTime: 60, workHours: 8,
    } });

    await materialize();
    assert.equal(await statusOf(att20.id), '正常', 'writing back display_status must not invalidate itself');
    await scheduleOn(staff.id, '2026-11-20'); // 新增班表：只清該員工、該台北日
    assert.equal(await statusOf(att20.id), null);
    assert.equal(await statusOf(att21.id), '正常');
    assert.equal(await statusOf(colleague20.id), '正常');

    await materialize();
    await prisma.schedule.updateMany({ where: { employeeId: staff.id, workDate: '2026-11-20' }, data: { startTime: '07:00' } });
    assert.equal(await statusOf(att20.id), null, 'schedule edit must invalidate the cached status');
    assert.equal(await statusOf(att21.id), '正常');

    await materialize();
    await prisma.schedule.updateMany({ where: { employeeId: staff.id, workDate: '2026-11-20' }, data: { workDate: '2026-11-21' } });
    assert.equal(await statusOf(att20.id), null, 'moving a schedule must invalidate the old day');
    assert.equal(await statusOf(att21.id), null, 'moving a schedule must invalidate the new day');

    await materialize();
    await prisma.schedule.deleteMany({ where: { employeeId: staff.id, workDate: '2026-11-21' } });
    assert.equal(await statusOf(att21.id), null, 'schedule delete must invalidate the cached status');
    assert.equal(await statusOf(att20.id), '正常');
    assert.equal(await statusOf(colleague20.id), '正常');

    // 補打卡／修改打卡：任何寫入路徑改到上下班時間都會清掉那一筆（包含 upsert 的更新分支）
    await prisma.attendanceRecord.update({ where: { id: att20.id }, data: { clockOutTime: new Date('2026-11-20T10:00:00Z') } });
    assert.equal(await statusOf(att20.id), null, 'clock-out edit must invalidate the cached status');
    assert.equal(await statusOf(colleague20.id), '正常');
    await materialize();
    await prisma.attendanceRecord.upsert({
      where: { employeeId_workDate: { employeeId: staff.id, workDate: taipeiMidnight('2026-11-20') } },
      update: { clockInTime: new Date('2026-11-20T01:30:00Z') },
      create: { employeeId: staff.id, workDate: taipeiMidnight('2026-11-20') },
    });
    assert.equal(await statusOf(att20.id), null, 'upsert update branch must invalidate the cached status');
    await prisma.attendanceRecord.update({ where: { id: att21.id }, data: { notes: 'unrelated edit' } });
    assert.equal(await statusOf(colleague20.id), '正常');

    // migration 一次性清掉既有（可能已過期）的狀態，且可重複套用
    await materialize();
    execFileSync('python3', ['-c', `import sqlite3,pathlib,sys
c=sqlite3.connect(sys.argv[1])
c.executescript(pathlib.Path(sys.argv[2]).read_text())
c.close()`, database, path.join(root, 'prisma/migrations/20261123_fix_attendance_display_status_invalidation/migration.sql')]);
    assert.equal(await statusOf(att20.id), null);
    assert.equal(await statusOf(colleague20.id), null);
    await materialize();
    await scheduleOn(colleague.id, '2026-11-20');
    assert.equal(await statusOf(colleague20.id), null, 'triggers still work after re-applying the migration');

    console.log('PASS: 24 concurrent maintenance requests, pending-task guard, atomic rollback and retry, same-code assets across sites, legacy record IDs, cron generation, import ownership conflicts, attendance status invalidation');
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
