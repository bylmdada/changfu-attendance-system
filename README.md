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

## VPS 手動部署（PM2 / 非 Docker）

正式環境使用 **DigitalOcean Droplet / VPS + PM2 + Nginx**，不走 Docker。專案根目錄已提供同一套 PM2 / NVM 部署腳本，可由**本機手動執行**或由 **GitHub Actions `workflow_dispatch`** 觸發：

```bash
# 先在 VPS 準備好 nvm / Node / PM2 / .env.production
./setup-production.sh

# 在本機執行手動部署
VPS_HOST=your-vps-ip ./deploy-vps.sh
```

`deploy-vps.sh` 預設會先讀取 **VPS 目前 nvm 使用的 Node 版本**，再用同一個版本建置、安裝依賴、執行 Prisma migration 並 reload PM2。
部署腳本也會把 PM2 綁到 **VPS 當前 nvm 的 Node binary**，避免 DigitalOcean VPS 重開或 PM2 reload 後誤用系統 Node。若需要固定版本，可在 GitHub Actions Variables 或本機環境變數設定 `EXPECTED_NODE_VERSION`。

### 建議的 DigitalOcean / PM2 初始化流程

1. 在 Droplet 上安裝 `nvm`，並用它安裝正式環境 Node 版本，例如 `nvm install 20.19.6 && nvm alias default 20.19.6`。
2. 執行 `./setup-production.sh`，讓 VPS 依目前 nvm Node 版本確認 `.env.production`、PM2 都已就緒。
3. 首次部署後，依腳本提示執行 `pm2 startup`，把目前 nvm Node 路徑寫進 systemd。
4. 本機執行 `VPS_HOST=your-vps-ip ./deploy-vps.sh`，或在 GitHub Actions 手動觸發 `Deploy to DigitalOcean VPS`，完成同步、Prisma migration 與 PM2 reload。

### 版本規則

- 支援正式環境 Node 範圍為 **>=20.19.6 <23**。
- `deploy-vps.sh` 預設以 VPS 目前 Node 版本為準；`.nvmrc` 只作為本機/CI 預設版本。
- 若你在 VPS 升級 Node，請先在 VPS 切換/設定 default，再重新執行：

```bash
./setup-production.sh
VPS_HOST=your-vps-ip ./deploy-vps.sh
```

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
