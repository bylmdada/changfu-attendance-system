// 修復舊排程規則留下的「補產生逾期任務」：
// 舊規則在產生任務時就把下次應維護日推進一個週期，逾期完成後會立刻再產生一筆已逾期的任務。
// 新規則改為「下次應維護日 = 最近完成日 + 頻率」，此腳本把已受影響的財產調整成新規則：
// 刪除到期日不晚於最近完成日、且尚未動工的待執行任務，並重設下次應維護日。
// 預設只預覽；加 --apply 才寫入。正式機：node --env-file=.env scripts/repair-property-catchup-tasks.cjs [--apply]
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

// 與 src/lib/property-maintenance-utils.ts getNextMaintenanceDate 相同規則（.cjs 無法引用 TS）
const FREQUENCY_MONTHS = { 每月一次: 1, 每季一次: 3, 每半年一次: 6, 每年一次: 12 };
const DAY_MS = 24 * 60 * 60 * 1000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiParts(date) {
  const shifted = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

function taipeiMidnight(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d) - TAIPEI_OFFSET_MS);
}

function startOfDay(date) {
  const p = taipeiParts(date);
  return taipeiMidnight(p.y, p.m, p.d);
}

function ymd(date) {
  const p = taipeiParts(date);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function nextMaintenanceDate(completedAt, frequency, frequencyDays) {
  const months = frequency ? FREQUENCY_MONTHS[String(frequency).trim().replace(/\s+/g, '')] : undefined;
  if (!months) return new Date(startOfDay(completedAt).getTime() + frequencyDays * DAY_MS);
  const p = taipeiParts(completedAt);
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return taipeiMidnight(y, m, Math.min(p.d, lastDay));
}

async function main() {
  const assets = await prisma.propertyAsset.findMany({
    where: { isActive: true, frequencyDays: { not: null } },
    select: {
      id: true,
      assetCode: true,
      maintenanceFrequency: true,
      frequencyDays: true,
      nextMaintenanceDate: true,
      site: { select: { name: true } },
      records: {
        where: { status: { in: ['DONE', 'ABNORMAL'] }, completedDate: { not: null } },
        orderBy: { completedDate: 'desc' },
        take: 1,
        select: { completedDate: true },
      },
    },
  });

  const fixes = [];
  for (const asset of assets) {
    const completedAt = asset.records[0]?.completedDate;
    if (!completedAt) continue;
    const completedDayEnd = new Date(startOfDay(completedAt).getTime() + DAY_MS);

    const pending = await prisma.maintenanceRecord.findMany({
      where: { assetId: asset.id, status: 'PENDING', dueDate: { lt: completedDayEnd } },
      select: {
        id: true,
        recordId: true,
        completedDate: true,
        photoPath: true,
        signaturePath: true,
        _count: { select: { attachments: true } },
      },
    });
    // 已動工（退回重送、已上傳照片/簽章/附件）的任務保留，交由人工處理
    const started = pending.filter(
      (r) => r.completedDate || r.photoPath || r.signaturePath || r._count.attachments > 0
    );
    const catchup = pending.filter((r) => !started.includes(r));
    const staleNext = !asset.nextMaintenanceDate || asset.nextMaintenanceDate < completedDayEnd;
    if (catchup.length === 0 && !staleNext) continue;

    fixes.push({
      asset,
      completedAt,
      catchup,
      started,
      newNext: nextMaintenanceDate(completedAt, asset.maintenanceFrequency, asset.frequencyDays),
    });
  }

  for (const fix of fixes) {
    const { asset } = fix;
    console.log(
      `${asset.site.name} ${asset.assetCode}（${asset.maintenanceFrequency}）最近完成 ${ymd(fix.completedAt)}：` +
        `下次應維護 ${asset.nextMaintenanceDate ? ymd(asset.nextMaintenanceDate) : '未設定'} → ${ymd(fix.newNext)}` +
        (fix.catchup.length ? `；刪除補產生任務 ${fix.catchup.map((r) => r.recordId).join('、')}` : '') +
        (fix.started.length ? `；已動工保留 ${fix.started.map((r) => r.recordId).join('、')}` : '')
    );
  }
  console.log(`共 ${fixes.length} 筆財產需調整${apply ? '' : '（預覽模式，加 --apply 才寫入）'}`);
  if (!apply) return;

  for (const fix of fixes) {
    await prisma.$transaction([
      prisma.maintenanceRecord.deleteMany({
        where: { id: { in: fix.catchup.map((r) => r.id) }, status: 'PENDING', completedDate: null },
      }),
      prisma.propertyAsset.update({
        where: { id: fix.asset.id },
        data: { nextMaintenanceDate: fix.newNext },
      }),
    ]);
  }
  console.log(`已調整 ${fixes.length} 筆財產`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
