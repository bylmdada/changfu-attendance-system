# 長福里出勤管理系統

基於 [Next.js](https://nextjs.org) 開發的員工出勤管理系統，支援打卡、排班、請假及薪資計算等功能。

## 功能特色

- 員工打卡（支援 WiFi 位置驗證）
- 排班管理
- 請假申請與審核
- 薪資計算
- 管理員後台

## Getting Started

```bash
npm install
npm run dev
```

開啟 [http://localhost:3001](http://localhost:3001) 查看結果。

## 技術棧

- **Frontend**: Next.js, React, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: SQLite (Prisma ORM)

## AI 代碼審查 (Codex Review)

本專案整合 [codex-review](https://github.com/BenedictKing/codex-review) 進行 AI 輔助代碼審查與自動產生 CHANGELOG。

### 安裝 Codex Review

```bash
npx skills add -g BenedictKing/codex-review
```

### 使用方式

在 Claude Code 中執行：

```
/codex-review
```

### 最佳實踐

- 保持 `CHANGELOG.md` 在專案根目錄
- 使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式撰寫 commit 訊息（如 `feat:`, `fix:`, `docs:`）
- 大規模重構前先執行代碼審查

## License

本專案採用 [MIT License](LICENSE) 授權。

Copyright (c) 2026 bylmdada
