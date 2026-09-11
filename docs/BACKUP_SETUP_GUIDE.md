# 備份設定指南 - Synology NAS + Google Drive

## 一、安裝備份工具

### 1. 安裝必要套件

```bash
# 安裝 SQLite 命令列工具
sudo apt install -y sqlite3

# 安裝 rclone（用於 Google Drive）
curl https://rclone.org/install.sh | sudo bash
```

---

## 二、設定 Synology NAS

### 1. NAS 端設定

1. 開啟 **DSM** → **控制台** → **共用資料夾**
2. 建立共用資料夾 `backups`
3. 建立子資料夾 `attendance`

### 2. 設定 SSH 金鑰（免密碼登入）

```bash
# 在 VPS 上生成金鑰
ssh-keygen -t rsa -b 4096 -f ~/.ssh/nas_backup -N ""

# 將公鑰複製到 NAS
ssh-copy-id -i ~/.ssh/nas_backup.pub your_user@192.168.1.100

# 測試連線
ssh -i ~/.ssh/nas_backup your_user@192.168.1.100 "echo 連線成功"
```

### 3. 同步正式備份腳本

正式環境請以 repo 內的 `scripts/backup-database.sh` 為唯一來源，並同步到 VPS：

```bash
scp scripts/backup-database.sh deploy@YOUR_SERVER_IP:/home/deploy/backup-database.sh
ssh deploy@YOUR_SERVER_IP 'chmod +x /home/deploy/backup-database.sh && bash -n /home/deploy/backup-database.sh'
```

目前正式腳本會使用 SQLite `.backup` 產生一致性備份，壓縮後再執行 `PRAGMA integrity_check;`。rclone 未設定時會保留本機備份並記錄警告；若要強制雲端同步成功才視為備份成功，可加 `RCLONE_REQUIRED=1`。

---

## 三、設定 Google Drive

### 1. 設定 rclone

```bash
rclone config
```

按照提示操作：
1. 輸入 `n` 建立新設定
2. 名稱輸入 `gdrive`
3. 選擇 `Google Drive` (編號 17 或搜尋)
4. `client_id` 和 `client_secret` 留空（按 Enter）
5. scope 選擇 `1` (Full access)
6. 其他選項按 Enter 使用預設值
7. 選擇 `n` (No)，然後按照連結登入 Google 帳號授權

### 2. 測試連線

```bash
# 列出 Google Drive 根目錄
rclone ls gdrive:

# 建立備份資料夾
rclone mkdir gdrive:backups/attendance

# 測試上傳
echo "test" > /tmp/test.txt
rclone copy /tmp/test.txt gdrive:backups/attendance/
rclone ls gdrive:backups/attendance/
```

---

## 四、設定自動備份（Cron）

### 1. 編輯 crontab

```bash
crontab -e
```

### 2. 加入排程

```bash
# 每天台灣時間凌晨 3:00 執行備份（UTC 19:00）
0 19 * * * DB_PATH=/home/deploy/apps/changfu-attendance/prisma/prod.db BACKUP_DIR=/home/deploy/backups LOG_FILE=/home/deploy/backup.log /home/deploy/apps/changfu-attendance/scripts/backup-database.sh

# 如需調整策略，先更新 repo 的 scripts/backup-database.sh，再重新同步
```

### 3. 賦予執行權限

```bash
ssh deploy@YOUR_SERVER_IP 'chmod +x /home/deploy/backup-database.sh'
```

---

## 五、驗證備份

### 手動測試

```bash
# 執行備份
ssh deploy@YOUR_SERVER_IP 'DB_PATH=/home/deploy/apps/changfu-attendance/prisma/prod.db BACKUP_DIR=/home/deploy/backups LOG_FILE=/home/deploy/backup.log /home/deploy/apps/changfu-attendance/scripts/backup-database.sh'

# 檢查本地備份
ssh deploy@YOUR_SERVER_IP 'ls -la /home/deploy/backups/'

# 驗證最新備份完整性
ssh deploy@YOUR_SERVER_IP 'LATEST=$(ls -t /home/deploy/backups/attendance_*.db.gz | head -n 1); gunzip -c "$LATEST" > /tmp/attendance-restore-check.db; sqlite3 /tmp/attendance-restore-check.db "PRAGMA integrity_check;"; rm -f /tmp/attendance-restore-check.db'

# 檢查 Google Drive
ssh deploy@YOUR_SERVER_IP 'rclone ls gdrive1:changfu-backups/'
ssh deploy@YOUR_SERVER_IP 'rclone ls gdrive2:changfu-backups/'

# 檢查 NAS（透過 SSH）
ssh your_user@192.168.1.100 "ls -la /volume1/backups/attendance/"
```

### 還原測試

```bash
# 停止服務
pm2 stop attendance

# 存目前 DB
cp /home/deploy/apps/changfu-attendance/prisma/prod.db /home/deploy/apps/changfu-attendance/prisma/prod.db.broken-$(date +%Y%m%d-%H%M%S)

# 還原資料庫
gunzip -c /home/deploy/backups/attendance_YYYYMMDD_HHMMSS.db.gz > /home/deploy/apps/changfu-attendance/prisma/prod.db

# 完整性檢查
sqlite3 /home/deploy/apps/changfu-attendance/prisma/prod.db "PRAGMA integrity_check;"

# 重啟應用
pm2 start attendance
```

---

## 六、備份策略總結

| 備份位置 | 頻率 | 保留期限 |
|----------|------|----------|
| VPS 本地 | 每日 | 30 天 |
| Synology NAS | 每日 | 90 天（建議） |
| Google Drive | 每日 | 30 天 |

---

## 七、故障排除

### NAS 連線失敗

```bash
# 檢查網路
ping 192.168.1.100

# 檢查 SSH 連線
ssh -v your_user@192.168.1.100
```

### Google Drive 上傳失敗

```bash
# 檢查 rclone 設定
rclone config show gdrive

# 重新授權
rclone config reconnect gdrive:
```

### 備份檔案過大

```bash
# 壓縮資料庫（清理日誌）
sqlite3 /home/deploy/app/prisma/prod.db "VACUUM;"
```
