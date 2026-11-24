// 財產管理資料唯讀盤點：部署「紀錄ID／審核清單／狀態文字／評鑑總表」修正前後，量化既有資料的影響。
// 只讀不寫（僅 findMany / groupBy / count）。正式機：node --env-file=.env scripts/audit-property-data.cjs
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SAMPLE = 10;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function ymd(date) {
  const shifted = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

function section(title, rows, hint) {
  console.log(`\n■ ${title}：${rows.length} 筆`);
  if (hint) console.log(`  ${hint}`);
  for (const row of rows.slice(0, SAMPLE)) console.log(`  - ${row}`);
  if (rows.length > SAMPLE) console.log(`  …其餘 ${rows.length - SAMPLE} 筆省略`);
}

async function main() {
  // 1) 同一個財產編號出現在多個據點：條碼／QR 必須帶據點代碼才找得到正確資產
  const duplicated = await prisma.propertyAsset.groupBy({
    by: ['assetCode'],
    _count: { _all: true },
    having: { assetCode: { _count: { gt: 1 } } },
  });
  section(
    '財產編號重複出現在多個據點',
    duplicated.map((row) => `${row.assetCode}（${row._count._all} 個據點）`),
    '這些資產的舊裸碼標籤無法分辨據點，掃碼會提示改掃新版條碼（含據點代碼）。'
  );

  // 2) 同一資產、同一天（台北）有多筆維護紀錄
  const dated = await prisma.maintenanceRecord.findMany({
    where: { dueDate: { not: null } },
    select: { recordId: true, assetId: true, assetCode: true, dueDate: true },
  });
  const byAssetDay = new Map();
  for (const record of dated) {
    const key = `${record.assetId}|${ymd(record.dueDate)}`;
    byAssetDay.set(key, [...(byAssetDay.get(key) ?? []), record]);
  }
  section(
    '同一資產、同一到期日有多筆紀錄',
    [...byAssetDay.values()]
      .filter((records) => records.length > 1)
      .map((records) => `${records[0].assetCode} ${ymd(records[0].dueDate)}：${records.map((r) => r.recordId).join('、')}`)
  );

  // 3) 掃碼評量與狀態原文不一致（舊版把「有異常」存成「已完成」）；新版匯出已改以評量結果為準
  const assessed = await prisma.maintenanceRecord.findMany({
    where: { conditionAssessmentStatus: { not: null } },
    select: { recordId: true, status: true, rawStatus: true, conditionAssessmentStatus: true },
  });
  const expectedRaw = { ABNORMAL: '有異常', NO_ABNORMALITY: '無異常' };
  section(
    '掃碼評量結果與狀態原文不一致',
    assessed
      .filter((record) => expectedRaw[record.conditionAssessmentStatus] && record.rawStatus !== expectedRaw[record.conditionAssessmentStatus])
      .map((record) => `${record.recordId}：評量 ${record.conditionAssessmentStatus}，狀態原文「${record.rawStatus ?? ''}」`),
    '資料本身不會被改寫；月報／佐證／歷程匯出對這些紀錄會顯示評量結果。'
  );

  // 4) 已提交（狀態不是待執行）、稽核狀態待審，但沒有待審輪次：歷史匯入件。
  //    新版核決時會補一筆「已決定」的輪次，所以它們仍會出現在主管審核清單並可被處理。
  const awaiting = await prisma.maintenanceRecord.findMany({
    where: { auditStatus: 'PENDING', status: { not: 'PENDING' } },
    select: { recordId: true, assetCode: true, completedDate: true },
  });
  const withRound = new Set();
  for (let i = 0; i < awaiting.length; i += 500) {
    const slice = awaiting.slice(i, i + 500).map((record) => record.recordId);
    const rounds = await prisma.auditApproval.findMany({
      where: { auditStatus: 'PENDING', recordId: { in: slice } },
      select: { recordId: true },
    });
    for (const round of rounds) withRound.add(round.recordId);
  }
  console.log(`\n■ 主管審核清單（已提交且待稽核）：${awaiting.length} 筆`);
  section(
    '主管審核清單內沒有待審輪次的歷史匯入件',
    awaiting
      .filter((record) => !withRound.has(record.recordId))
      .map((record) => `${record.recordId}（${record.assetCode}，完成 ${record.completedDate ? ymd(record.completedDate) : '—'}）`),
    '核決時會自動補輪次；若不打算由主管逐筆處理，請先決定如何批次結案。'
  );

  // 5) 尚未提交的任務：舊版審核清單會把它們列進去（auditStatus 預設也是 PENDING），新版不再列
  const unsubmitted = await prisma.maintenanceRecord.count({ where: { auditStatus: 'PENDING', status: 'PENDING' } });
  console.log(`\n■ 尚未提交、稽核狀態預設為待審的任務：${unsubmitted} 筆`);
  console.log('  舊版會出現在主管審核清單（核准會得到 409）；新版審核清單不再列出。');

  // 6) 已停用但近一年仍有維護紀錄的資產：評鑑總表現在會列出它們（標示「目前已停用」）
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const inactive = await prisma.maintenanceRecord.groupBy({
    by: ['assetCode', 'siteId'],
    where: { asset: { isActive: false }, dueDate: { gte: since } },
    _count: { _all: true },
  });
  section('已停用但近一年仍有維護紀錄的資產', inactive.map((row) => `${row.assetCode}（據點 ${row.siteId}，${row._count._all} 筆）`));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
