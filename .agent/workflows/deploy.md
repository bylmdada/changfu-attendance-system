---
description: 部署到 DigitalOcean VPS（Cloudflare SSL + Namecheap 網域）
---

# 部署 Workflow

## 環境資訊
- **VPS IP**: 188.166.229.128
- **用戶**: deploy
- **路徑**: ~/apps/changfu-attendance
- **SSL**: Cloudflare
- **網域**: Namecheap.me
- **Node**: 透過 nvm 管理（SSH 需先 source ~/.nvm/nvm.sh）
- **程序管理**: PM2（程序名稱: attendance）
- **VPS RAM**: 1GB（不建議在 VPS 上 build）
- **正式環境埠號**: 3000（Nginx 目前代理到 localhost:3000）

---

## 一鍵部署（預設流程）

依序執行以下 4 個步驟，每步驟完成後再執行下一步。

// turbo
### Step 1: 本機 Build
```bash
cd /Users/feng/changfu-attendance-system && npm run build
```

// turbo
### Step 2: 同步程式碼到 VPS
排除 node_modules、.next、.git、資料庫、uploads、.env：
```bash
cd /Users/feng/changfu-attendance-system && rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '.git' --exclude 'prisma/*.db*' --exclude 'uploads' --exclude '.env' ./ deploy@188.166.229.128:~/apps/changfu-attendance/
```

// turbo
### Step 3: 同步已建置的 .next 資料夾
VPS 記憶體不足，直接同步本機 build 產物：
```bash
cd /Users/feng/changfu-attendance-system && rsync -avz --delete .next/ deploy@188.166.229.128:~/apps/changfu-attendance/.next/
```

// turbo
### Step 4: 重啟 PM2 並確認狀態
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 restart attendance && sleep 5 && pm2 status && echo '=== 最近日誌 ===' && pm2 logs attendance --lines 10 --nostream"
```

---

## 完整部署（含 npm install）

當有新增/更新套件時，需在 VPS 上執行 npm install：

// turbo
### SSH 到 VPS 執行 npm install + 重啟
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && npm install --production && pm2 restart attendance && pm2 status"
```

> ⚠️ **注意**: 不要在 VPS 上執行 `npm run build`，1GB RAM 會 OOM。一律在本機 build 後 rsync .next/。

---

## 資料庫操作（謹慎使用）

// turbo
### 上傳本地資料庫到 VPS（會覆蓋線上資料）
```bash
scp /Users/feng/changfu-attendance-system/prisma/dev.db deploy@188.166.229.128:~/apps/changfu-attendance/prisma/prod.db
```

// turbo
### 從 VPS 下載資料庫備份
```bash
scp deploy@188.166.229.128:~/apps/changfu-attendance/prisma/prod.db /Users/feng/changfu-attendance-system/backups/prod_$(date +%Y%m%d).db
```

// turbo
### 在 VPS 上執行 Prisma 遷移
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && npx prisma migrate deploy"
```

---

## 查看狀態與日誌

// turbo
### 查看應用狀態
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 status"
```

// turbo
### 查看即時日誌（最近 50 行）
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 logs attendance --lines 50 --nostream"
```

// turbo
### 查看錯誤日誌
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 logs attendance --err --lines 30 --nostream"
```

---

## 問題排解

### Build OOM (記憶體不足)
- 一律在本機 `npm run build`，然後 rsync `.next/` 資料夾到 VPS

### npm command not found
- SSH 指令需先執行 `source ~/.nvm/nvm.sh`

### Failed to find Server Action
- 部署後舊版瀏覽器快取導致，使用者刷新頁面即可解決

### 無法連線 VPS
- 確認 IP: 188.166.229.128
- 確認使用 deploy 用戶
- 確認 SSH key 已設定

### PM2 程序不存在
- 首次設定：`ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && PORT=3000 pm2 start npm --name attendance -- start && pm2 save"`
