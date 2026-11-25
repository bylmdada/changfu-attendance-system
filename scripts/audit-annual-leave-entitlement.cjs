// 特休級距更正盤點（唯讀）：滿 10～24 年的特休原本少算 1 天（10 年算 15、應為 16；24 年算 29、應為 30）。
// 列出每一筆「特休年度紀錄」的現存總額與更正後法定天數，分成：
//   AFFECTED  現存總額＝舊公式的結果，且與更正後不同（需補差額；已休天數不動，剩餘＝新總額－已休）
//   ABOVE     現存總額高於法定（可能是人工給假優於法定標準，維持原狀）
//   OTHER     現存總額與新舊公式都不同（人工調整過，請人工確認）
// 只讀不寫。正式機：node --env-file=.env scripts/audit-annual-leave-entitlement.cjs [--year=2026] [--all]
// 預設只看在職員工；--all 連離職員工也列。補差額可到「特休假管理」選 AFFECTED 的員工按批次設定（會保留已休天數）。
const { PrismaClient } = require('@prisma/client');

// 與 src/lib/annual-leave-rules.ts 相同的算法（tests 會比對兩邊在 0～600 個月的結果完全一致）
function serviceTotalMonths(hireDate, referenceDate) {
  const hire = new Date(hireDate);
  const reference = new Date(referenceDate);
  let years = reference.getFullYear() - hire.getFullYear();
  let months = reference.getMonth() - hire.getMonth();
  if (reference.getDate() < hire.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return 0;
  return years * 12 + months;
}

function legalDays(totalMonths) {
  const normalizedMonths = Math.max(0, Math.floor(totalMonths));
  const completedYears = Math.floor(normalizedMonths / 12);
  if (normalizedMonths < 6) return 0;
  if (normalizedMonths < 12) return 3;
  if (completedYears < 2) return 7;
  if (completedYears < 3) return 10;
  if (completedYears < 5) return 14;
  if (completedYears < 10) return 15;
  return Math.min(30, 15 + (completedYears - 9));
}

// 更正前的公式（滿 10 年起 15 + (年 − 10)），用來辨認哪些紀錄是舊公式算出來的
function legacyDays(totalMonths) {
  const normalizedMonths = Math.max(0, Math.floor(totalMonths));
  const completedYears = Math.floor(normalizedMonths / 12);
  if (completedYears < 10) return legalDays(totalMonths);
  return Math.min(30, 15 + (completedYears - 10));
}

function classify(row) {
  // 與「特休假管理」計算年度特休相同：以該年 12/31 的年資為基準
  const months = serviceTotalMonths(row.hireDate, new Date(row.year, 11, 31));
  const legal = legalDays(months);
  const legacy = legacyDays(months);
  if (row.totalDays === legal) return { kind: 'OK', legal, legacy };
  if (row.totalDays === legacy && legacy !== legal) return { kind: 'AFFECTED', legal, legacy };
  if (row.totalDays > legal) return { kind: 'ABOVE', legal, legacy };
  return { kind: 'OTHER', legal, legacy };
}

async function main() {
  const prisma = new PrismaClient();
  const yearArg = process.argv.find((arg) => arg.startsWith('--year='));
  const includeInactive = process.argv.includes('--all');
  const year = yearArg ? Number(yearArg.slice('--year='.length)) : null;
  if (yearArg && !Number.isInteger(year)) throw new Error('--year 必須是整數年份');

  try {
    const rows = await prisma.annualLeave.findMany({
      where: {
        ...(year ? { year } : {}),
        ...(includeInactive ? {} : { employee: { isActive: true } }),
      },
      include: { employee: { select: { employeeId: true, name: true, department: true, hireDate: true, isActive: true } } },
      orderBy: [{ year: 'desc' }, { employeeId: 'asc' }],
    });

    const groups = { OK: [], AFFECTED: [], ABOVE: [], OTHER: [] };
    for (const row of rows) {
      const result = classify({ year: row.year, totalDays: row.totalDays, hireDate: row.employee.hireDate });
      groups[result.kind].push({ row, ...result });
    }

    console.log(`特休年度紀錄共 ${rows.length} 筆${year ? `（${year} 年）` : ''}${includeInactive ? '，含離職員工' : '，僅在職員工'}`);
    console.log(`  與更正後法定天數相同：${groups.OK.length} 筆`);
    console.log(`  需補差額（現存＝舊公式結果）：${groups.AFFECTED.length} 筆`);
    console.log(`  高於法定（可能是人工給假，維持原狀）：${groups.ABOVE.length} 筆`);
    console.log(`  與新舊公式都不同（人工調整過，請人工確認）：${groups.OTHER.length} 筆`);

    const print = (title, items, withRemaining) => {
      if (!items.length) return;
      console.log(`\n■ ${title}（${items.length} 筆）`);
      for (const { row, legal } of items) {
        const diff = legal - row.totalDays;
        const remainingAfter = Math.max(0, legal - row.usedDays);
        console.log(
          `  - ${row.year} 年 ${row.employee.employeeId} ${row.employee.name}（${row.employee.department || '未分部門'}）` +
          `：現存 ${row.totalDays} 天，法定 ${legal} 天（${diff >= 0 ? '+' : ''}${diff}），已休 ${row.usedDays}，` +
          (withRemaining ? `剩餘 ${row.remainingDays} → 補差額後 ${remainingAfter}` : `剩餘 ${row.remainingDays}`)
        );
      }
    };
    print('需補差額', groups.AFFECTED, true);
    print('高於法定（維持原狀）', groups.ABOVE, false);
    print('人工調整過，請人工確認', groups.OTHER, false);
    console.log('\n（唯讀盤點，沒有改動任何資料）');
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { serviceTotalMonths, legalDays, legacyDays, classify };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
