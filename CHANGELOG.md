# Changelog

本文件記錄所有重要的版本變更，格式依照 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/) 規範，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

### Added
- 文件化補休 `IMPORT` baseline 修復 CLI 的 dry-run、`--apply`、`--employeeId`、`--database` 與全庫 `--confirm` 操作流程。
- 補休 `IMPORT` baseline 修復 CLI 新增 `--json` dry-run 輸出，可直接產生結構化檢查結果供留存與比對。

### Changed
- 補休 `IMPORT` baseline 修復 CLI 現在支援 `--database=<path|url>` 明確指定 SQLite 目標，並提供較清楚的資料來源與空資料庫/缺表錯誤訊息。
- 補休 `IMPORT` baseline 修復 CLI 現在要求全庫 `--apply` 額外帶 `--confirm=REPAIR_ALL_IMPORT_BASELINES`，避免誤操作直接寫入全部員工資料。
- 完成 2026-04-08 production 補休 `IMPORT` baseline 唯讀驗證：正式環境資料庫與最新備份 dry-run 均回傳 `no-data`，`comp_leave_transactions` 現況不需執行修復寫入。

## [1.0.0] - 2026-03-18

### Added
- 員工打卡功能（支援 WiFi 位置驗證）
- 排班管理系統
- 請假申請與審核流程
- 薪資計算功能
- 管理員後台
- 打卡時段限制（台灣時區）
- MIT License
- Codex Review 整合支援
