## 可貼到 CHANGELOG 的文字

### Verified
- 以 2026-04-08 的 production 離線快照驗證補休 `IMPORT` baseline 修復流程：`comp_leave_transactions` 為空表，repair CLI 的 `--json` dry-run 回傳 `status: "no-data"`、`affectedEmployees: 0`、`deleteImportCount: 0`，確認目前 production 沒有可修復的重複 `IMPORT` baseline，也不需要執行 `--apply`。

## 可貼到維運紀錄的文字

- 驗證日期：2026-04-08
- 驗證方式：
  - 以只讀方式確認 production 使用中的資料庫快照
  - 於受控的離線環境執行 repair CLI：`tsx scripts/repair-comp-leave-import-baselines.ts --database=<snapshot> --json`
- 驗證結果：
  - 離線快照中的 `comp_leave_transactions` 總筆數為 0
  - `transaction_type = 'EARN' AND reference_type = 'IMPORT'` 的資料筆數為 0
  - dry-run JSON 結果為 `status: "no-data"`
  - `affectedEmployees = 0`
  - `deleteImportCount = 0`
- 結論：目前 production 沒有任何可修復的補休 `IMPORT` baseline 資料，不應執行 repair CLI 的 `--apply`。
- 驗證產物：
  - JSON 報告：`ops/comp-leave-import-validation/20260408/repair-dry-run.json`
  - 實際 production 快照僅保留於受控備份儲存位置，不納入版本控制。