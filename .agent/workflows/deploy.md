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

---

## 快速部署（一鍵執行）

// turbo
1. 提交並推送程式碼到 GitHub：
```bash
cd /Users/feng/changfu-attendance-system
git add -A && git commit -m "deploy: update" && git push origin main
```

// turbo
2. 同步程式碼到 VPS（排除 node_modules、.next、資料庫）：
```bash
rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '.git' --exclude 'prisma/*.db*' --exclude 'uploads' ./ deploy@188.166.229.128:~/apps/changfu-attendance/
```

// turbo
3. 同步已建置的 .next 資料夾（VPS 記憶體不足時）：
```bash
rsync -avz --delete .next/ deploy@188.166.229.128:~/apps/changfu-attendance/.next/
```

// turbo
4. 重啟 PM2 應用程式：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 restart attendance && pm2 status"
```

---

## 完整部署（含 npm install 和 build）

如果有新增套件或需要重新 build：

// turbo
1. SSH 到 VPS 並執行完整部署：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && npm install && NODE_OPTIONS='--max-old-space-size=1024' npm run build && pm2 restart attendance"
```

> ⚠️ **注意**: VPS 只有 1GB RAM，build 可能 OOM。建議使用上方的「同步 .next」方式。

---

## 查看狀態與日誌

// turbo
- 查看應用狀態：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 status"
```

// turbo
- 查看即時日誌：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 logs attendance --lines 50"
```

---

## 資料庫同步（謹慎使用）

將本地資料庫上傳到 VPS（會覆蓋線上資料）：
```bash
scp ./prisma/dev.db deploy@188.166.229.128:~/apps/changfu-attendance/prisma/prod.db
```

從 VPS 下載資料庫到本地備份：
```bash
scp deploy@188.166.229.128:~/apps/changfu-attendance/prisma/prod.db ./backups/prod_$(date +%Y%m%d).db
```

---

## 問題排解

### Build OOM (記憶體不足)
- 使用本地 `npm run build`，然後 rsync `.next/` 資料夾

### npm command not found
- SSH 需要先執行 `source ~/.nvm/nvm.sh`

### 無法連線
- 確認 IP: 188.166.229.128
- 確認 SSH key 已設定
