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

## VPS 手動部署（DigitalOcean + PM2 / 非 Docker）

正式環境使用 **DigitalOcean Droplet / VPS + PM2 + Nginx**，不走 Docker。專案根目錄已提供同一套 PM2 / NVM 部署腳本，可由**本機手動執行**或由 **GitHub Actions `workflow_dispatch`** 觸發：

```bash
# 先在 VPS 準備好 nvm / Node / PM2 / .env.production
npm run setup:production

# 在本機執行手動部署；腳本會自動讀取 VPS 的 nvm/default Node 版本
VPS_HOST=your-vps-ip npm run deploy:vps
```

[`deploy-vps.sh`](deploy-vps.sh) 預設會先讀取 **VPS 目前 nvm/default Node 版本**，再用同一個版本完成本機/GitHub Actions 建置、VPS 依賴安裝與 PM2 reload。若需要臨時釘版，可設定 `EXPECTED_NODE_VERSION=20.19.6` 或在 GitHub Actions 手動部署時填入 `expected_node_version`。
部署腳本也會把 PM2 綁到 **VPS 當前 nvm 的 Node binary**，避免 DigitalOcean VPS 重開或 PM2 reload 後誤用系統 Node。

### 建議的 DigitalOcean / PM2 初始化流程

1. 在 Droplet 上安裝 `nvm`，並用它安裝/設定 VPS 正式環境要使用的 Node 版本（例如 `nvm install 20.19.6 && nvm alias default 20.19.6`）。
2. 執行 `./setup-production.sh`，讓 VPS 以目前 default Node 確認 `.env.production`、PM2 都已就緒。
3. 首次部署後，依腳本提示執行 `pm2 startup`，把目前 nvm Node 路徑寫進 systemd。
4. 本機執行 `VPS_HOST=your-vps-ip ./deploy-vps.sh`，或在 GitHub Actions 手動觸發 `Deploy to DigitalOcean VPS`，完成同步、Prisma migration 與 PM2 reload。

### 版本規則

- 正式部署支援 **Node >=20.19.6 且 <23**，可配合 DigitalOcean VPS 目前 Node 20/22 LTS。
- `.nvmrc` 保留作為本機/CI 預設版本；正式部署預設以 VPS current/default Node 為準。
- 若你在 VPS 升級 Node，請在 VPS 更新 `nvm alias default` 後重新執行：

```bash
npm run setup:production
VPS_HOST=your-vps-ip npm run deploy:vps
```

完整步驟請見 [`docs/DIGITALOCEAN_PM2_VPS_QUICKSTART.md`](docs/DIGITALOCEAN_PM2_VPS_QUICKSTART.md)。

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
