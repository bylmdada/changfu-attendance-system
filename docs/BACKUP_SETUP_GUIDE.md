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

### 3. 修改備份腳本

編輯 `scripts/backup.sh`，更新以下設定：

```bash
NAS_USER="your_nas_user"      # 您的 NAS 帳號
NAS_HOST="192.168.1.100"      # 您的 NAS IP
NAS_PATH="/volume1/backups/attendance"
```

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
# 每天凌晨 3:00 執行備份
0 3 * * * /home/deploy/app/scripts/backup.sh >> /home/deploy/backups/cron.log 2>&1

# 或者：每天凌晨 3:00 和下午 15:00 執行（每日兩次）
0 3,15 * * * /home/deploy/app/scripts/backup.sh >> /home/deploy/backups/cron.log 2>&1
```

### 3. 賦予執行權限

```bash
chmod +x /home/deploy/app/scripts/backup.sh
```

---

## 五、驗證備份

### 手動測試

```bash
# 執行備份
/home/deploy/app/scripts/backup.sh

# 檢查本地備份
ls -la /home/deploy/backups/local/

# 檢查 Google Drive
rclone ls gdrive:backups/attendance/

# 檢查 NAS（透過 SSH）
ssh your_user@192.168.1.100 "ls -la /volume1/backups/attendance/"
```

### 還原測試

```bash
# 下載備份
cp /home/deploy/backups/local/attendance_backup_*.tar.gz /tmp/

# 解壓縮
cd /tmp && tar -xzf attendance_backup_*.tar.gz

# 還原資料庫
cp prod.db /home/deploy/app/prisma/prod.db

# 重啟應用
pm2 restart attendance
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
