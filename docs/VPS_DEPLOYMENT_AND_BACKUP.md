# 長福考勤系統 - VPS 部署與備份完整指南

## 目錄

1. [系統需求](#一系統需求)
2. [VPS 初始設定](#二vps-初始設定)
3. [部署應用程式](#三部署應用程式)
4. [Nginx 設定](#四nginx-反向代理)
5. [備份設定](#五備份設定)
6. [自動備份腳本](#六自動備份腳本)
7. [常用指令](#七常用指令)

---

## 一、系統需求

| 項目 | 最低需求 | 建議規格 |
|------|----------|----------|
| CPU | 1 核心 | 2 核心 |
| RAM | 2 GB | 4 GB |
| SSD | 20 GB | 40 GB |
| OS | Ubuntu 22.04 | Ubuntu 22.04 LTS |

### 推薦 VPS 供應商

| 供應商 | 規格 | 月費 |
|--------|------|------|
| Contabo | 4 CPU / 8GB RAM | ~NT$200 |
| Vultr | 2 CPU / 4GB RAM | ~NT$760 |
| DigitalOcean | 2 CPU / 4GB RAM | ~NT$760 |

---

## 二、VPS 初始設定

### 1. 連線到 VPS

```bash
ssh root@your-vps-ip
```

### 2. 建立部署用戶

```bash
adduser deploy
usermod -aG sudo deploy
su - deploy
```

### 3. 安裝必要軟體

```bash
# 更新系統
sudo apt update && sudo apt upgrade -y

# 安裝 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 安裝其他工具
sudo apt install -y git nginx certbot python3-certbot-nginx sqlite3

# 安裝 rclone（備份用）
curl https://rclone.org/install.sh | sudo bash

# 確認版本
node -v && npm -v
```

---

## 三、部署應用程式

### 1. 克隆專案

```bash
cd /home/deploy
git clone https://github.com/your-repo/changfu-attendance-system.git app
cd app
npm install
```

### 2. 設定環境變數

```bash
nano .env
```

```env
DATABASE_URL="file:/home/deploy/app/prisma/prod.db"
JWT_SECRET="your-super-secret-key-at-least-32-chars"
NODE_ENV="production"
```

### 3. 初始化資料庫

```bash
npx prisma db push
npx prisma db seed  # 如果有種子資料
```

### 4. 建置並啟動

```bash
npm run build

# 使用 PM2 管理程序
sudo npm install -g pm2
pm2 start npm --name "attendance" -- start
pm2 startup
pm2 save
```

---

## 四、Nginx 反向代理

### 1. 建立設定檔

```bash
sudo nano /etc/nginx/sites-available/attendance
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 2. 啟用設定並申請 SSL

```bash
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

### 3. 防火牆

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## 五、備份設定

### 備份架構

```
VPS 資料庫 (prod.db)
    ↓ 每日凌晨 3:00
    ├── 本地 /home/deploy/backups/（保留 30 天）
    ├── Synology NAS（異地備份 1）
    └── Google Drive（異地備份 2）
```

### 5.1 設定 Synology NAS

**NAS 端：**
1. DSM → 控制台 → 共用資料夾 → 建立 `backups/attendance`

**VPS 端：**
```bash
# 生成 SSH 金鑰
ssh-keygen -t rsa -b 4096 -f ~/.ssh/nas_backup -N ""

# 複製到 NAS
ssh-copy-id -i ~/.ssh/nas_backup.pub your_user@192.168.1.100

# 測試
ssh -i ~/.ssh/nas_backup your_user@192.168.1.100 "echo OK"
```

### 5.2 設定 Google Drive

```bash
rclone config
```

1. 輸入 `n` → 名稱 `gdrive`
2. 選擇 `Google Drive`
3. 其他選項按 Enter
4. 按照連結授權

**測試：**
```bash
rclone mkdir gdrive:backups/attendance
rclone ls gdrive:backups/attendance/
```

---

## 六、自動備份腳本

### 6.1 備份腳本內容

建立 `/home/deploy/app/scripts/backup.sh`：

```bash
#!/bin/bash
# === 設定 ===
APP_DIR="/home/deploy/app"
DB_FILE="$APP_DIR/prisma/prod.db"
BACKUP_DIR="/home/deploy/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="attendance_backup_$DATE"

# NAS 設定
NAS_USER="your_nas_user"
NAS_HOST="192.168.1.100"
NAS_PATH="/volume1/backups/attendance"

# Google Drive
GDRIVE_REMOTE="gdrive"
GDRIVE_PATH="backups/attendance"

# === 執行備份 ===
mkdir -p "$BACKUP_DIR/local" "$BACKUP_DIR/temp"

# 備份資料庫
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/temp/prod.db'"
cp "$APP_DIR/.env" "$BACKUP_DIR/temp/" 2>/dev/null

# 壓縮
cd "$BACKUP_DIR/temp"
tar -czf "$BACKUP_DIR/local/$BACKUP_NAME.tar.gz" ./*
rm -rf "$BACKUP_DIR/temp"

# 上傳 NAS
scp "$BACKUP_DIR/local/$BACKUP_NAME.tar.gz" \
    "$NAS_USER@$NAS_HOST:$NAS_PATH/" 2>/dev/null

# 上傳 Google Drive
rclone copy "$BACKUP_DIR/local/$BACKUP_NAME.tar.gz" \
    "$GDRIVE_REMOTE:$GDRIVE_PATH/" 2>/dev/null

# 清理 30 天前備份
find "$BACKUP_DIR/local" -name "*.tar.gz" -mtime +30 -delete
rclone delete "$GDRIVE_REMOTE:$GDRIVE_PATH/" --min-age 30d 2>/dev/null

echo "備份完成: $BACKUP_NAME.tar.gz"
```

### 6.2 設定權限

```bash
chmod +x /home/deploy/app/scripts/backup.sh
```

### 6.3 設定 Cron 自動執行

```bash
crontab -e
```

加入：
```bash
# 每日凌晨 3:00 備份
0 3 * * * /home/deploy/app/scripts/backup.sh >> /home/deploy/backups/cron.log 2>&1
```

---

## 七、常用指令

### 應用程式管理

| 動作 | 指令 |
|------|------|
| 查看狀態 | `pm2 status` |
| 查看日誌 | `pm2 logs attendance` |
| 重啟 | `pm2 restart attendance` |
| 更新部署 | `git pull && npm run build && pm2 restart attendance` |

### 備份管理

| 動作 | 指令 |
|------|------|
| 手動備份 | `/home/deploy/app/scripts/backup.sh` |
| 查看本地備份 | `ls -la /home/deploy/backups/local/` |
| 查看雲端備份 | `rclone ls gdrive:backups/attendance/` |

### 還原資料庫

```bash
# 解壓備份
tar -xzf backup.tar.gz

# 還原
cp prod.db /home/deploy/app/prisma/prod.db
pm2 restart attendance
```

---

## 快速部署檢查表

- [ ] VPS 購買並連線
- [ ] 建立 deploy 用戶
- [ ] 安裝 Node.js、Nginx、PM2
- [ ] 克隆專案並設定 .env
- [ ] 初始化資料庫
- [ ] 設定 Nginx 和 SSL
- [ ] 設定 Synology NAS SSH
- [ ] 設定 rclone Google Drive
- [ ] 建立備份腳本
- [ ] 設定 Cron 自動備份
- [ ] 測試備份和還原
