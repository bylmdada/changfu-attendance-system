---
description: 檢查 VPS 日誌並除錯
---

# VPS 除錯 Workflow

## VPS 資訊
- **IP**: 188.166.229.128
- **用戶**: deploy
- **路徑**: ~/apps/changfu-attendance

---

## 1. 快速檢查狀態

// turbo
查看 PM2 應用程式狀態：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 status"
```

---

## 2. 查看日誌

// turbo
查看最近 50 行日誌（含錯誤）：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 logs attendance --lines 50 --nostream"
```

// turbo
即時追蹤日誌：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 logs attendance"
```
> 按 `Ctrl+C` 結束追蹤

---

## 3. 常見問題排查

### 3.1 資料庫錯誤 (Table does not exist)

// turbo
檢查資料庫檔案和 .env 設定：
```bash
ssh deploy@188.166.229.128 "ls -la ~/apps/changfu-attendance/prisma/*.db* && cat ~/apps/changfu-attendance/.env | grep DATABASE"
```

修復方法 - 執行資料庫遷移：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && npx prisma db push && pm2 restart attendance"
```

### 3.2 IP 被封鎖 (Rate Limit)

// turbo
清除所有 IP 封鎖和速率限制：
```bash
ssh deploy@188.166.229.128 "sqlite3 ~/apps/changfu-attendance/prisma/prod.db 'DELETE FROM ip_blocks; DELETE FROM rate_limit_records;' && echo '✅ 已清除'"
```

### 3.3 Server Action 錯誤

這表示瀏覽器快取與伺服器版本不匹配。

**解決方法**：
1. 用戶端：清除瀏覽器快取或使用無痕模式
2. 伺服器端：重新部署 .next 資料夾（使用 `/deploy` workflow）

### 3.4 Build OOM（記憶體不足）

本機 build 後同步到 VPS：
```bash
# 本機執行
DATABASE_URL="file:./prisma/prod.db" npm run build
rsync -avz --delete .next/ deploy@188.166.229.128:~/apps/changfu-attendance/.next/
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 restart attendance"
```

---

## 4. 重啟服務

// turbo
重啟 PM2 應用程式：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 restart attendance && pm2 status"
```

---

## 5. 資料庫檢查

// turbo
列出所有資料表：
```bash
ssh deploy@188.166.229.128 "sqlite3 ~/apps/changfu-attendance/prisma/prod.db '.tables'"
```

// turbo
查詢使用者帳號：
```bash
ssh deploy@188.166.229.128 "sqlite3 ~/apps/changfu-attendance/prisma/prod.db 'SELECT id, username, role, is_active FROM users;'"
```

// turbo
查詢員工列表：
```bash
ssh deploy@188.166.229.128 "sqlite3 ~/apps/changfu-attendance/prisma/prod.db 'SELECT id, employee_id, name, department FROM employees LIMIT 20;'"
```

---

## 6. 備份還原

列出可用備份：
```bash
ssh deploy@188.166.229.128 "ls -la ~/backups/"
```

從備份還原（替換日期）：
```bash
ssh deploy@188.166.229.128 "cd ~/backups && gunzip -k attendance_YYYYMMDD_HHMMSS.db.gz && cp attendance_YYYYMMDD_HHMMSS.db ~/apps/changfu-attendance/prisma/prod.db && rm attendance_YYYYMMDD_HHMMSS.db"
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 restart attendance"
```
