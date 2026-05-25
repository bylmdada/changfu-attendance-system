/**
 * 一次性／可重複執行的財產盤點匯入。
 * 用法：npm run import:property -- /Users/feng/Downloads/財產盤點.xlsx
 */
import fs from 'node:fs';
import { importPropertyWorkbook } from '@/lib/property-import-service';
import { DEFAULT_SITE } from '@/lib/app-config';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('用法：npm run import:property -- <檔案路徑.xlsx>');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`找不到檔案：${filePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  console.log(`讀取 ${filePath} …`);

  const result = await importPropertyWorkbook(buffer, {
    defaultSiteName: DEFAULT_SITE.name,
    defaultSiteCode: DEFAULT_SITE.code,
    institutionTitle: DEFAULT_SITE.institutionTitle,
  });

  console.log('\n=== 匯入結果 ===');
  console.log(result.message);
  console.log(JSON.stringify(result.results, null, 2));
  if (result.unresolvedMaintainers.length) {
    console.log('\n未解析維護人員（前 20）：');
    console.table(result.unresolvedMaintainers.slice(0, 20));
  }
  if (result.errors.length) {
    console.log(`\n警告 ${result.errors.length} 則（前 20）：`);
    result.errors.slice(0, 20).forEach((e) => console.log(' -', e));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('匯入失敗：', e);
    process.exit(1);
  });
