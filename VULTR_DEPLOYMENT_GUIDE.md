# 長福會考勤系統 - Vultr Tokyo 佈署指南

## 📋 環境需求

- **VPS**: Vultr Cloud Compute (Tokyo)
- **規格**: 1 vCPU / 1GB RAM / 25GB SSD
- **OS**: Ubuntu 22.04 LTS
- **月費**: $6 (含自動備份)

---

## 🚀 第一部分：VPS 建立與基礎設定

### 1.1 建立 Vultr 實例

1. 登入 [vultr.com](https://vultr.com)
2. Deploy → Cloud Compute → Regular Performance
3. 選擇 **Tokyo** (NRT)
4. 選擇 **Ubuntu 22.04 LTS x64**
5. 選擇 **$5/月 方案**
6. ✅ 勾選 **Enable Auto Backups** (+$1/月)
7. 設定 SSH Key（建議）或記住 root 密碼
8. Deploy Now

### 1.2 首次連線

```bash
# 使用 SSH 連線（替換成你的 IP）
ssh root@YOUR_SERVER_IP
```

### 1.3 系統更新與基礎安全

```bash
# 更新系統
apt update && apt upgrade -y

# 安裝基本工具
apt install -y curl wget git unzip htop ufw

# 設定防火牆
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80
ufw allow 443
ufw --force enable
```

### 1.4 建立非 root 用戶

```bash
# 建立用戶（替換 username）
adduser deploy
usermod -aG sudo deploy

# 切換到新用戶
su - deploy
```

---

## 🟢 第二部分：安裝 Node.js 與相關工具

### 2.1 安裝 Node.js 20 LTS

```bash
# 安裝 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc

# 安裝 Node.js 20
nvm install 20
nvm use 20
nvm alias default 20

# 驗證
node -v  # 應顯示 v20.x.x
npm -v
```

### 2.2 安裝 PM2 (程序管理器)

```bash
npm install -g pm2
```

### 2.3 安裝 Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

---

## 📦 第三部分：部署專案

### 3.1 上傳專案

```bash
# 建立專案目錄
mkdir -p ~/apps
cd ~/apps

# 方法 A：從 Git 拉取
git clone YOUR_REPO_URL changfu-attendance

# 方法 B：從本機上傳（在本機執行）
# scp -r ./changfu-attendance-system deploy@YOUR_IP:~/apps/changfu-attendance
```

### 3.2 安裝依賴並建置

```bash
cd ~/apps/changfu-attendance

# 安裝依賴
npm install

# 建立 .env 檔案
nano .env
```

**.env 內容**：
```env
DATABASE_URL="file:./prisma/prod.db"
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long
ENCRYPTION_KEY=your-32-byte-encryption-key-here
NODE_ENV=production
```

```bash
# 資料庫遷移
npx prisma migrate deploy

# 建置專案
npm run build
```

### 3.3 使用 PM2 啟動

```bash
# 啟動
pm2 start npm --name "attendance" -- start

# 設定開機自啟
pm2 startup
pm2 save

# 查看狀態
pm2 status
pm2 logs attendance
```

---

## 🔒 第四部分：Nginx 反向代理 + SSL

### 4.1 設定 Nginx

```bash
sudo nano /etc/nginx/sites-available/attendance
```

**內容**：
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# 啟用設定
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4.2 安裝 SSL (Let's Encrypt)

```bash
# 安裝 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 取得憑證
sudo certbot --nginx -d your-domain.com

# 自動更新
sudo certbot renew --dry-run
```

---

## 💾 第五部分：每日備份到 Google Drive + Synology

### 5.1 安裝 rclone

```bash
curl https://rclone.org/install.sh | sudo bash
```

### 5.2 設定 Google Drive

```bash
rclone config

# 選擇：n (new remote)
# name: gdrive
# Storage: drive (Google Drive)
# 依照指示完成 OAuth 授權
```

### 5.3 設定 Synology BeeStation

BeeStation 使用 WebDAV 協定：

```bash
rclone config

# 選擇：n (new remote)
# name: synology
# Storage: webdav
# URL: https://YOUR_BEESTATION_IP:5006
# vendor: other
# user: 你的 Synology 帳號
# pass: 你的密碼
```

### 5.4 建立備份腳本

```bash
nano ~/backup.sh
```

**內容**：
```bash
#!/bin/bash

# 設定變數
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/attendance_backup"
DB_PATH="$HOME/apps/changfu-attendance/prisma/prod.db"
BACKUP_NAME="attendance_backup_$DATE.tar.gz"

# 建立備份目錄
mkdir -p $BACKUP_DIR

# 備份資料庫
cp $DB_PATH $BACKUP_DIR/

# 壓縮
cd $BACKUP_DIR
tar -czf $BACKUP_NAME prod.db

# 上傳到 Google Drive
rclone copy $BACKUP_NAME gdrive:AttendanceBackups/ --progress

# 上傳到 Synology BeeStation
rclone copy $BACKUP_NAME synology:AttendanceBackups/ --progress

# 清理暫存
rm -rf $BACKUP_DIR

# 刪除 30 天前的備份（Google Drive）
rclone delete gdrive:AttendanceBackups/ --min-age 30d

# 刪除 30 天前的備份（Synology）
rclone delete synology:AttendanceBackups/ --min-age 30d

echo "✅ 備份完成: $BACKUP_NAME"
```

```bash
# 設定執行權限
chmod +x ~/backup.sh

# 測試執行
./backup.sh
```

### 5.5 設定每日自動執行

```bash
crontab -e

# 加入以下行（每天凌晨 3:00 執行）
0 3 * * * /home/deploy/backup.sh >> /home/deploy/backup.log 2>&1
```

---

## 📊 第六部分：監控與維護

### 6.1 查看系統狀態

```bash
# PM2 狀態
pm2 status
pm2 logs attendance --lines 100

# 系統資源
htop

# 磁碟空間
df -h
```

### 6.2 更新部署

```bash
cd ~/apps/changfu-attendance

# 拉取最新代碼
git pull

# 安裝新依賴
npm install

# 重新建置
npm run build

# 重啟
pm2 restart attendance
```

---

## ✅ 完成檢查清單

- [ ] VPS 建立成功
- [ ] SSH 可連線
- [ ] 防火牆設定完成
- [ ] Node.js 20 安裝完成
- [ ] PM2 安裝完成
- [ ] 專案部署完成
- [ ] Nginx 設定完成
- [ ] SSL 憑證安裝完成
- [ ] Google Drive 備份測試成功
- [ ] Synology 備份測試成功
- [ ] Cron 排程設定完成

---

## 🆘 常見問題

### Q: PM2 重啟後應用沒有自動啟動？
```bash
pm2 startup
pm2 save
```

### Q: Nginx 502 Bad Gateway？
```bash
pm2 status  # 確認應用有在運行
pm2 restart attendance
```

### Q: rclone 權限錯誤？
```bash
rclone config reconnect gdrive:
```

### Q: 資料庫鎖定錯誤？
```bash
# 停止應用後再備份
pm2 stop attendance
./backup.sh
pm2 start attendance
```
