# 長福會考勤系統 - DigitalOcean 佈署指南

## 🎓 GitHub Student Developer Pack 福利

- **免費額度**: $200 USD
- **可用時間**: ~33 個月（$6/月方案）
- **申請方式**: [education.github.com](https://education.github.com/pack)

> 注意：本文件主路徑適用於 `DigitalOcean VPS + PM2 + Nginx`。若您改走容器化部署，請改參考根目錄 `deploy-vps.sh` 與 `docker-compose.production.yml`。無論 PM2 或 Docker，建議統一使用 `3001` 作為應用程式 upstream port。

---

## 📋 環境需求

- **VPS**: DigitalOcean Droplet
- **規格**: 1 vCPU / 1GB RAM / 25GB SSD
- **機房**: Singapore (SGP1)
- **OS**: Ubuntu 22.04 LTS
- **月費**: $6 (含自動備份) → **學生免費**

---

## 🚀 第一部分：建立 Droplet

### 1.1 啟用 GitHub Student Pack

1. 前往 [education.github.com/pack](https://education.github.com/pack)
2. 驗證學生身份
3. 取得 DigitalOcean $200 額度連結
4. 點擊連結並登入/註冊 DigitalOcean

### 1.2 建立 Droplet

1. 登入 [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. Create → Droplets
3. 選擇 Region: **Singapore (SGP1)**
4. 選擇 Image: **Ubuntu 22.04 (LTS) x64**
5. 選擇 Size: **Basic → $6/mo** (1 GB / 1 CPU / 25 GB SSD)
6. ✅ 勾選 **Enable Backups** (+$1.20/月)
7. Authentication: 選擇 **SSH Key**（推薦）
8. Hostname: `attendance-system`
9. Create Droplet

### 1.3 首次連線

```bash
# 使用 SSH 連線（替換成 Droplet IP）
ssh root@YOUR_DROPLET_IP
```

### 1.4 系統更新與基礎安全

```bash
# 更新系統
apt update && apt upgrade -y

# 安裝基本工具
apt install -y curl wget git unzip htop ufw

# 設定防火牆
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

### 1.5 建立非 root 用戶

```bash
# 建立用戶
adduser deploy
usermod -aG sudo deploy

# 複製 SSH 金鑰
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

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

### 2.2 安裝 PM2

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

### 3.1 上傳專案程式碼

**方法 A：從 Git 拉取**
```bash
mkdir -p ~/apps
cd ~/apps
git clone YOUR_REPO_URL changfu-attendance
```

**方法 B：從本機上傳（在本機執行）**
```bash
scp -r ./changfu-attendance-system deploy@YOUR_IP:~/apps/changfu-attendance
```

### 3.2 上傳開發環境資料庫（重要！）

> ⚠️ **注意**：資料庫檔案不會透過 Git 上傳，需手動複製！

**在本機執行**（保留開發環境的員工帳號密碼）：
```bash
# 上傳開發環境資料庫到 VPS
scp ./prisma/dev.db deploy@YOUR_VPS_IP:~/apps/changfu-attendance/prisma/prod.db
```

**資料遷移說明**：

| 項目 | 透過 Git | 需手動複製 |
|------|---------|-----------|
| 程式碼 | ✅ | - |
| 環境變數(.env) | ❌ | ✅ |
| **資料庫(.db)** | ❌ | ✅ |
| 員工帳號/密碼 | ❌ | ✅ (含在資料庫內) |
| 考勤記錄 | ❌ | ✅ (含在資料庫內) |

### 3.3 安裝依賴並建置

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

### 3.4 使用 PM2 啟動

```bash
# 啟動（明確綁定 3001，避免回到 next start 預設 3000）
PORT=3001 pm2 start npm --name "attendance" -- start

# 設定開機自啟
pm2 startup
pm2 save

# 查看狀態
pm2 status

# 健康檢查
curl http://127.0.0.1:3001/api/health
```

---

## 🔒 第四部分：Nginx + SSL

### 4.1 設定 Nginx

```bash
sudo nano /etc/nginx/sites-available/attendance
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
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

### 4.2 安裝 SSL

如果您是使用 Cloudflare DNS 與 Cloudflare SSL Full/Strict，建議不要在這裡申請 Let's Encrypt，請直接改參考 [CLOUDFLARE_DEPLOYMENT_GUIDE.md](./CLOUDFLARE_DEPLOYMENT_GUIDE.md) 配置 Origin Certificate。

如果您沒有使用 Cloudflare，才建議使用 Let's Encrypt：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 💾 第五部分：每日備份 (Google Drive + Synology)

### 5.1 安裝 rclone

```bash
curl https://rclone.org/install.sh | sudo bash
```

### 5.2 設定 Google Drive

```bash
rclone config
# n → gdrive → drive → 依照指示完成授權
```

### 5.3 設定 Synology BeeStation

```bash
rclone config
# n → synology → webdav → https://YOUR_BEESTATION_IP:5006
```

### 5.4 建立備份腳本

```bash
nano ~/backup.sh
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/tmp/attendance_backup"
DB_PATH="$HOME/apps/changfu-attendance/prisma/prod.db"
BACKUP_NAME="attendance_backup_$DATE.tar.gz"

mkdir -p $BACKUP_DIR
cp $DB_PATH $BACKUP_DIR/
cd $BACKUP_DIR && tar -czf $BACKUP_NAME prod.db

# 上傳
rclone copy $BACKUP_NAME gdrive:AttendanceBackups/
rclone copy $BACKUP_NAME synology:AttendanceBackups/

# 清理
rm -rf $BACKUP_DIR
rclone delete gdrive:AttendanceBackups/ --min-age 30d
rclone delete synology:AttendanceBackups/ --min-age 30d

echo "✅ 備份完成: $BACKUP_NAME"
```

```bash
chmod +x ~/backup.sh
```

### 5.5 設定每日自動執行

```bash
crontab -e
# 加入：
0 3 * * * /home/deploy/backup.sh >> /home/deploy/backup.log 2>&1
```

---

## 💰 費用計算（使用學生 Pack）

| 項目 | 原價 | 學生價 |
|------|------|--------|
| Droplet $6/月 | $6 | **$0** (從 $200 扣) |
| 自動備份 | $1.20 | **$0** (從 $200 扣) |
| Google Drive | $0 | $0 |
| Synology | $0 | $0 |
| **總計** | $7.20/月 | **$0/月** |

**免費使用期間**: ~27 個月（$200 ÷ $7.20）

---

## ✅ 完成檢查清單

- [ ] GitHub Student Pack 啟用
- [ ] DigitalOcean $200 額度取得
- [ ] Droplet 建立完成
- [ ] 防火牆設定完成
- [ ] Node.js + PM2 安裝完成
- [ ] 專案部署完成
- [ ] SSL 憑證安裝完成
- [ ] 備份設定完成

---

## 📚 DigitalOcean 官方教學

| 主題 | 連結 |
|------|------|
| 初始設定 | [Initial Server Setup](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-22-04) |
| Node.js 安裝 | [How to Install Node.js](https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-ubuntu-22-04) |
| Nginx 設定 | [Nginx Reverse Proxy](https://www.digitalocean.com/community/tutorials/how-to-set-up-a-node-js-application-for-production-on-ubuntu-22-04) |
| SSL 憑證 | [Let's Encrypt](https://www.digitalocean.com/community/tutorials/how-to-secure-nginx-with-let-s-encrypt-on-ubuntu-22-04) |
| Cloudflare SSL | [CLOUDFLARE_DEPLOYMENT_GUIDE.md](./CLOUDFLARE_DEPLOYMENT_GUIDE.md) |
