# 自動備份設定指南

本指南說明如何設定 crontab 自動執行備份腳本，將資料備份到 Google Drive 和 Synology NAS (BeeStation)。

---

## 前置準備

### 1. 安裝必要工具

```bash
# 安裝 rclone（用於 Google Drive 備份）
curl https://rclone.org/install.sh | sudo bash

# 確認 rsync 已安裝（用於 NAS 備份）
sudo apt install rsync -y
```

### 2. 設定 rclone（Google Drive）

```bash
rclone config
```

按照提示操作：
1. 選擇 `n` 建立新 remote
2. 名稱輸入：`gdrive`
3. 選擇 `drive`（Google Drive）
4. client_id 和 client_secret 可留空
5. scope 選擇 `1`（完整存取）
6. 按照指示完成 OAuth 授權

### 3. 設定 SSH 金鑰（NAS 免密碼登入）

```bash
# 產生 SSH 金鑰（如尚未產生）
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa_nas

# 將公鑰複製到 NAS
ssh-copy-id -i ~/.ssh/id_rsa_nas.pub your-user@192.168.1.100
```

---

## 設定備份腳本

### 1. 編輯備份腳本設定

```bash
nano /var/www/changfu-attendance-system/scripts/backup.sh
```

修改以下設定：
```bash
# 專案路徑
PROJECT_DIR="/var/www/changfu-attendance-system"

# NAS 設定
NAS_ENABLED=true
NAS_USER="your-nas-user"
NAS_HOST="192.168.1.100"
NAS_BACKUP_PATH="/volume1/backup/changfu-attendance"

# Google Drive 設定
GDRIVE_ENABLED=true
GDRIVE_REMOTE="gdrive"
GDRIVE_PATH="changfu-backup"
```

### 2. 設定執行權限

```bash
chmod +x /var/www/changfu-attendance-system/scripts/backup.sh
```

### 3. 測試備份腳本

```bash
sudo /var/www/changfu-attendance-system/scripts/backup.sh
```

---

## 設定 Crontab 自動執行

### 編輯 crontab

```bash
sudo crontab -e
```

### 新增以下排程

```cron
# 長福考勤系統 - 自動備份
# ========================================

# 每日凌晨 2:00 執行完整備份
0 2 * * * /var/www/changfu-attendance-system/scripts/backup.sh >> /var/log/changfu-backup.log 2>&1

# 每 6 小時執行一次備份（更頻繁保護）
# 0 */6 * * * /var/www/changfu-attendance-system/scripts/backup.sh >> /var/log/changfu-backup.log 2>&1
```

### 儲存並退出
- nano：按 `Ctrl+O` 儲存，`Ctrl+X` 退出
- vim：按 `Esc`，輸入 `:wq` 儲存並退出

---

## Crontab 時間格式說明

```
分 時 日 月 週 指令
│  │  │  │  │
│  │  │  │  └── 0-7（0 和 7 都是週日）
│  │  │  └───── 1-12（月份）
│  │  └──────── 1-31（日期）
│  └─────────── 0-23（小時）
└────────────── 0-59（分鐘）
```

### 常用排程範例

| 說明 | Crontab 語法 |
|-----|-------------|
| 每日凌晨 2:00 | `0 2 * * *` |
| 每 6 小時 | `0 */6 * * *` |
| 每週日凌晨 3:00 | `0 3 * * 0` |
| 每月 1 日凌晨 1:00 | `0 1 1 * *` |

---

## 驗證備份

### 1. 檢查備份日誌

```bash
tail -f /var/log/changfu-backup.log
```

### 2. 檢查 NAS 備份

```bash
ssh your-user@192.168.1.100 "ls -la /volume1/backup/changfu-attendance/"
```

### 3. 檢查 Google Drive 備份

```bash
rclone ls gdrive:changfu-backup/
```

---

## 還原備份

### 1. 從 NAS 還原

```bash
# 下載備份
scp your-user@192.168.1.100:/volume1/backup/changfu-attendance/changfu-backup-*.tar.gz /tmp/

# 解壓縮
tar -xzf /tmp/changfu-backup-*.tar.gz -C /tmp/

# 還原資料庫
cp /tmp/dev.db.backup /var/www/changfu-attendance-system/prisma/dev.db
```

### 2. 從 Google Drive 還原

```bash
# 下載備份
rclone copy gdrive:changfu-backup/changfu-backup-*.tar.gz /tmp/

# 解壓縮並還原
tar -xzf /tmp/changfu-backup-*.tar.gz -C /tmp/
cp /tmp/dev.db.backup /var/www/changfu-attendance-system/prisma/dev.db
```

---

## 故障排除

### 問題：rclone 找不到指令
```bash
# 重新安裝
curl https://rclone.org/install.sh | sudo bash
```

### 問題：SSH 連線 NAS 失敗
```bash
# 檢查連線
ssh -v your-user@192.168.1.100

# 確認金鑰權限
chmod 600 ~/.ssh/id_rsa_nas
```

### 問題：備份檔案太大
- 考慮使用增量備份
- 或僅備份資料庫和 .env 檔案

---

## 建議的備份策略

| 備份類型 | 頻率 | 保留時間 |
|---------|------|---------|
| 完整備份 | 每日 | 30 天 |
| 週備份 | 每週日 | 90 天 |
| 月備份 | 每月 1 日 | 1 年 |

---

*最後更新：2024年12月*
