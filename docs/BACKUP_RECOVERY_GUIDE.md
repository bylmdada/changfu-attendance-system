# 長福會考勤系統 - 備份與救援指南

## 📋 備份策略總覽

| 項目 | 設定 |
|------|------|
| 備份頻率 | 每日凌晨 03:00（台灣時間） |
| 備份方式 | 自動 + 手動 |
| 備份目標 | 2 個 Google Drive |
| 本地保留 | 7 天 |
| 雲端保留 | 30 天 |

---

## 🗄️ Google Drive 帳號

| 代號 | 帳號 |
|------|------|
| gdrive1 | horay0972@gmail.com |
| gdrive2 | seimitsujoystick@gmail.com |

備份檔案位置：`changfu-backups/` 資料夾

---

## ⏰ 自動備份排程

```bash
# Cron 設定（UTC 時間）
0 19 * * * /home/deploy/backup-database.sh

# 對應台灣時間
每日 03:00 AM
```

### 檢查排程

```bash
ssh deploy@188.166.229.128 'crontab -l'
```

---

## 🔧 手動備份指令

### 立即執行備份

```bash
ssh deploy@188.166.229.128 '/home/deploy/backup-database.sh'
```

### 檢查備份狀態

```bash
# 查看備份日誌
ssh deploy@188.166.229.128 'tail -20 /home/deploy/backup.log'

# 查看本地備份
ssh deploy@188.166.229.128 'ls -lh /home/deploy/backups/'

# 查看 Google Drive 備份
ssh deploy@188.166.229.128 'rclone ls gdrive1:changfu-backups/'
ssh deploy@188.166.229.128 'rclone ls gdrive2:changfu-backups/'
```

---

## 🔄 救援步驟

### 情況 1：VPS 正常，需要還原資料

```bash
# 1. 連線到 VPS
ssh deploy@188.166.229.128

# 2. 列出可用備份
rclone ls gdrive1:changfu-backups/

# 3. 下載指定備份（替換檔名）
mkdir -p ~/restore
rclone copy gdrive1:changfu-backups/attendance_YYYYMMDD_HHMMSS.db.gz ~/restore/

# 4. 解壓縮
cd ~/restore
gunzip attendance_*.db.gz

# 5. 停止應用程式
pm2 stop attendance

# 6. 備份現有資料庫（以防萬一）
cp ~/apps/changfu-attendance/prisma/prod.db ~/apps/changfu-attendance/prisma/prod.db.broken

# 7. 還原資料庫
cp ~/restore/attendance_*.db ~/apps/changfu-attendance/prisma/prod.db

# 8. 重啟應用程式
pm2 start attendance

# 9. 清理
rm -rf ~/restore
```

### 情況 2：VPS 故障，需要在新伺服器還原

```bash
# 1. 在本機下載備份
rclone copy gdrive1:changfu-backups/ ./backups/

# 2. 選擇最新的備份檔
ls -la ./backups/

# 3. 解壓縮
gunzip ./backups/attendance_YYYYMMDD_HHMMSS.db.gz

# 4. 重新命名為 prod.db
mv ./backups/attendance_*.db ./prod.db

# 5. 上傳到新 VPS
scp ./prod.db deploy@NEW_VPS_IP:~/apps/changfu-attendance/prisma/prod.db

# 6. 重啟應用
ssh deploy@NEW_VPS_IP 'pm2 restart attendance'
```

### 情況 3：在本機檢視備份內容

```bash
# 下載備份
rclone copy gdrive1:changfu-backups/attendance_YYYYMMDD_HHMMSS.db.gz ./

# 解壓縮
gunzip attendance_*.db.gz

# 使用 SQLite 檢視
sqlite3 attendance_*.db

# 常用查詢
.tables                           # 列出所有資料表
SELECT * FROM employees LIMIT 5;  # 查看員工資料
.quit                             # 退出
```

---

## 🛠️ 維護指令

### 手動清理舊備份

```bash
# 清理本地超過 7 天的備份
ssh deploy@188.166.229.128 'find /home/deploy/backups -name "*.gz" -mtime +7 -delete'

# 清理 Google Drive 超過 30 天的備份
ssh deploy@188.166.229.128 'rclone delete --min-age 30d gdrive1:changfu-backups/'
ssh deploy@188.166.229.128 'rclone delete --min-age 30d gdrive2:changfu-backups/'
```

### 重新授權 Google Drive

如果 token 過期，需要重新授權：

```bash
# 在 Mac 上
rclone config reconnect gdrive1:
rclone config reconnect gdrive2:

# 上傳新設定到 VPS
scp ~/.config/rclone/rclone.conf deploy@188.166.229.128:~/.config/rclone/rclone.conf
```

---

## 📊 備份檔案命名規則

```
attendance_YYYYMMDD_HHMMSS.db.gz

範例：
attendance_20260102_200420.db.gz
         │        │
         │        └── 台灣時間 20:04:20
         └── 日期 2026年1月2日
```

**時區**：所有備份檔名使用**台灣時間 (UTC+8)**

---

## ⚠️ 重要提醒

1. **定期檢查**：每週檢查一次備份日誌確認備份正常執行
2. **Token 效期**：Google OAuth token 可能會過期，如遇錯誤需重新授權
3. **磁碟空間**：VPS 磁碟空間有限，確保自動清理有正常運作
4. **測試還原**：建議每季度測試一次還原流程

---

## 📞 緊急聯絡

- **VPS 供應商**：DigitalOcean
- **VPS IP**：188.166.229.128
- **網域**：changfu.me
