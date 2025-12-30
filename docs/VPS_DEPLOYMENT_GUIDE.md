# VPS 部署指南 - 長福考勤系統

## 系統需求

| 項目 | 最低需求 | 建議規格 |
|------|----------|----------|
| CPU | 1 核心 | 2 核心 |
| RAM | 2 GB | 4 GB |
| SSD | 20 GB | 40 GB |
| OS | Ubuntu 22.04 | Ubuntu 22.04 LTS |

---

## 一、VPS 初始設定

### 1. 連線到 VPS

```bash
ssh root@your-vps-ip
```

### 2. 建立部署用戶

```bash
# 建立用戶
adduser deploy
usermod -aG sudo deploy

# 切換到新用戶
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
sudo apt install -y git nginx certbot python3-certbot-nginx

# 安裝 qpdf（PDF 密碼加密用）
sudo apt install -y qpdf

# 確認版本
node -v  # 應該顯示 v20.x.x
npm -v
qpdf --version  # 應該顯示 qpdf version 11.x 或更高
```

---

## 二、部署應用程式

### 1. 克隆專案

```bash
cd /home/deploy
git clone https://github.com/your-repo/changfu-attendance-system.git app
cd app
```

### 2. 安裝依賴

```bash
npm install
```

### 3. 設定環境變數

```bash
nano .env
```

```env
DATABASE_URL="file:/home/deploy/app/prisma/prod.db"
JWT_SECRET="your-super-secret-key-at-least-32-chars"
NODE_ENV="production"
```

### 4. 初始化資料庫

```bash
npx prisma db push
npx prisma db seed  # 如果有種子資料
```

### 5. 建置專案

```bash
npm run build
```

### 6. 使用 PM2 啟動

```bash
# 安裝 PM2
sudo npm install -g pm2

# 啟動應用
pm2 start npm --name "attendance" -- start

# 設定開機自動啟動
pm2 startup
pm2 save
```

---

## 三、Nginx 反向代理

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

### 2. 啟用設定

```bash
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. 設定 SSL 憑證

```bash
sudo certbot --nginx -d your-domain.com
```

---

## 四、防火牆設定

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## 五、常用指令

| 動作 | 指令 |
|------|------|
| 查看應用狀態 | `pm2 status` |
| 查看日誌 | `pm2 logs attendance` |
| 重啟應用 | `pm2 restart attendance` |
| 停止應用 | `pm2 stop attendance` |
| 更新應用 | `git pull && npm run build && pm2 restart attendance` |

---

## 六、資料庫位置

```
/home/deploy/app/prisma/prod.db
```

**重要**：此檔案需要定期備份！
