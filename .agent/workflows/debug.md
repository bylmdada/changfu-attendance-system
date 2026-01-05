---
description: 檢查 VPS 日誌並除錯
---

# VPS 除錯 Workflow

## VPS 資訊
- **IP**: 188.166.229.128
- **用戶**: deploy
- **路徑**: ~/apps/changfu-attendance
- **資料庫**: ~/apps/changfu-attendance/prisma/prod.db

---

## 🔍 1. 快速診斷

// turbo
**一鍵診斷：** 查看 PM2 狀態、最近錯誤、資料庫連線：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && echo '=== PM2 狀態 ===' && pm2 status && echo '=== 最近錯誤 ===' && pm2 logs attendance --lines 10 --nostream 2>&1 | tail -20 && echo '=== 資料庫檢查 ===' && cat ~/apps/changfu-attendance/.env | grep DATABASE && sqlite3 ~/apps/changfu-attendance/prisma/prod.db 'SELECT COUNT(*) as 用戶數 FROM users;'"
```

---

## 📜 2. 查看日誌

// turbo
查看最近 50 行日誌：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 logs attendance --lines 50 --nostream"
```

// turbo
即時追蹤日誌（Ctrl+C 結束）：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 logs attendance"
```

---

## 🚨 3. 常見問題排查

### ❌ 3.1 登入失敗 - 401 錯誤

**症狀**：API 返回 `{"error":"使用者名稱或密碼錯誤"}`

**診斷步驟**：

// turbo
1. 檢查 Prisma 是否能找到用戶：
```bash
ssh deploy@188.166.229.128 'source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && node -e "
const { PrismaClient } = require(\"@prisma/client\");
const prisma = new PrismaClient();
prisma.user.findMany().then(users => {
  console.log(\"Prisma 找到用戶數:\", users.length);
  users.forEach(u => console.log(\"-\", u.username));
  prisma.\$disconnect();
}).catch(e => console.log(\"錯誤:\", e.message));
"'
```

// turbo
2. 對比 SQLite 直接查詢：
```bash
ssh deploy@188.166.229.128 "sqlite3 ~/apps/changfu-attendance/prisma/prod.db 'SELECT COUNT(*) as count FROM users;'"
```

**如果 Prisma 顯示 0 用戶但 SQLite 有用戶 → DATABASE_URL 路徑問題！**

**修復**：確保 .env 使用**絕對路徑**：
```bash
ssh deploy@188.166.229.128 "sed -i 's|file:./prisma/prod.db|file:/home/deploy/apps/changfu-attendance/prisma/prod.db|g' ~/apps/changfu-attendance/.env && cat ~/apps/changfu-attendance/.env | grep DATABASE"
```

然後重新生成 Prisma Client 並重啟：
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && npx prisma generate && pm2 restart attendance"
```

---

### ❌ 3.2 資料庫錯誤 (Table does not exist)

**症狀**：`Error: The table main.users does not exist`

**原因**：
1. DATABASE_URL 指向錯誤的資料庫檔案
2. 資料庫未遷移

**修復**：
```bash
# 1. 確認 DATABASE_URL 使用絕對路徑
ssh deploy@188.166.229.128 "cat ~/apps/changfu-attendance/.env | grep DATABASE"
# 應該是: file:/home/deploy/apps/changfu-attendance/prisma/prod.db

# 2. 執行資料庫遷移
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && npx prisma db push && pm2 restart attendance"
```

---

### ❌ 3.3 IP 被封鎖 (Rate Limit)

**症狀**：`IP已被暫時封鎖，請在5分鐘後再試`

// turbo
**修復**：清除所有封鎖：
```bash
ssh deploy@188.166.229.128 "sqlite3 ~/apps/changfu-attendance/prisma/prod.db 'DELETE FROM ip_blocks; DELETE FROM rate_limit_records;' && echo '✅ 已清除'"
```

---

### ❌ 3.4 密碼驗證失敗

**診斷**：直接在 VPS 測試密碼驗證：
```bash
ssh deploy@188.166.229.128 'source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && node -e "
const bcryptjs = require(\"bcryptjs\");
const { execSync } = require(\"child_process\");
const hash = execSync(\"sqlite3 ~/apps/changfu-attendance/prisma/prod.db \\\"SELECT password_hash FROM users WHERE username='"'"'lifeng'"'"';\\\"\").toString().trim();
console.log(\"Hash:\", hash.substring(0, 30) + \"...\");
bcryptjs.compare(\"@Horay0628\", hash).then(r => console.log(\"驗證:\", r ? \"✅ 正確\" : \"❌ 錯誤\"));
"'
```

**重設密碼**：
```bash
ssh deploy@188.166.229.128 'source ~/.nvm/nvm.sh && cd ~/apps/changfu-attendance && node -e "
const bcryptjs = require(\"bcryptjs\");
bcryptjs.hash(\"你的新密碼\", 12).then(hash => {
  const fs = require(\"fs\");
  fs.writeFileSync(\"/tmp/newhash.txt\", hash);
  console.log(\"Hash 已生成\");
});
" && HASH=$(cat /tmp/newhash.txt) && sqlite3 ~/apps/changfu-attendance/prisma/prod.db "UPDATE users SET password_hash='"'"'$HASH'"'"' WHERE username='"'"'lifeng'"'"';" && echo "✅ 密碼已更新"'
```

---

### ❌ 3.5 Server Action 錯誤

**症狀**：`Failed to find Server Action "x"`

**原因**：瀏覽器快取與伺服器版本不匹配

**修復**：
1. 用戶端：清除瀏覽器快取或使用無痕模式
2. 或重新部署（使用 `/deploy`）

---

### ❌ 3.6 Build OOM（記憶體不足）

**症狀**：VPS 上 `npm run build` 被 Killed

**修復**：本機 build 後同步：
```bash
# 本機執行
DATABASE_URL="file:./prisma/prod.db" npm run build
rsync -avz --delete .next/ deploy@188.166.229.128:~/apps/changfu-attendance/.next/
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 restart attendance"
```

---

## 🔄 4. 重啟服務

// turbo
```bash
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 restart attendance && pm2 status"
```

---

## 💾 5. 資料庫操作

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

## 📦 6. 備份還原

// turbo
列出可用備份：
```bash
ssh deploy@188.166.229.128 "ls -la ~/backups/"
```

從備份還原：
```bash
ssh deploy@188.166.229.128 "cd ~/backups && gunzip -k attendance_YYYYMMDD_HHMMSS.db.gz && cp attendance_YYYYMMDD_HHMMSS.db ~/apps/changfu-attendance/prisma/prod.db && rm attendance_YYYYMMDD_HHMMSS.db"
ssh deploy@188.166.229.128 "source ~/.nvm/nvm.sh && pm2 restart attendance"
```

---

## 📝 重要教訓

### ⚠️ DATABASE_URL 必須使用絕對路徑

❌ **錯誤**：`file:./prisma/prod.db`（相對路徑在運行時解析錯誤）

✅ **正確**：`file:/home/deploy/apps/changfu-attendance/prisma/prod.db`

### ⚠️ 部署時不要覆蓋 VPS 的 .env

rsync 同步時務必排除 `.env`：
```bash
rsync -avz --exclude '.env' --exclude 'node_modules' --exclude 'prisma/*.db*' ...
```

### ⚠️ 本機 build 的 .next 需要 VPS 上重新生成 Prisma Client

上傳 .next 後，需要在 VPS 上：
```bash
npx prisma generate && pm2 restart attendance
```
