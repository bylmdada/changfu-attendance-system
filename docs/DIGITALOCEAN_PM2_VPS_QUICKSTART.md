# DigitalOcean + PM2 VPS 快速部署指南

本指南適用於長福會考勤系統的正式環境：**DigitalOcean Droplet / VPS + nvm Node.js + PM2 + Nginx**。部署流程會以 **VPS 目前的 nvm/default Node.js 版本** 作為基準，避免本機 build 與 VPS runtime Node 版本不一致。

## 1. VPS 首次初始化

以 `root` 登入 Droplet 後建立部署使用者：

```bash
apt update && apt upgrade -y
apt install -y curl git rsync nginx ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy /root/.ssh /home/deploy
```

切換到 `deploy` 使用者後安裝 `nvm` 與正式 Node.js 版本：

```bash
su - deploy
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
. /home/deploy/.nvm/nvm.sh
nvm install 20.19.6
nvm alias default 20.19.6
nvm use default
node -v
npm -v
npm install -g pm2
```

> 專案支援 [`package.json`](../package.json) 的 Node.js 範圍：`>=20.19.6 <23`。若 VPS 改用 Node 22 LTS，請先在 VPS 以 `nvm alias default` 設為該版本，再執行部署腳本。

## 2. VPS 專案目錄與環境檔

```bash
mkdir -p /home/deploy/apps/changfu-attendance
cd /home/deploy/apps/changfu-attendance
```

建立 `/home/deploy/apps/changfu-attendance/.env.production`：

```env
DATABASE_URL="file:./prisma/prod.db"
JWT_SECRET="請填入至少 32 字元"
NEXTAUTH_SECRET="請填入至少 32 字元"
NEXTAUTH_URL="https://your-domain.example"
NODE_ENV="production"
PORT="3000"
HOSTNAME="0.0.0.0"
TZ="Asia/Taipei"
NEXT_TELEMETRY_DISABLED="1"
```

若要沿用既有 SQLite 資料，請把資料庫放在：

```bash
/home/deploy/apps/changfu-attendance/prisma/prod.db
```

## 3. 從本機部署到 DigitalOcean VPS

在本機專案根目錄執行：

```bash
VPS_HOST=YOUR_DROPLET_IP npm run deploy:vps
```

常用參數：

```bash
VPS_HOST=YOUR_DROPLET_IP \
VPS_USER=deploy \
VPS_PORT=22 \
DEPLOY_PATH=/home/deploy/apps/changfu-attendance \
PM2_APP_NAME=attendance \
APP_PORT=3000 \
npm run deploy:vps
```

如果需要強制指定 Node.js 版本：

```bash
VPS_HOST=YOUR_DROPLET_IP EXPECTED_NODE_VERSION=20.19.6 npm run deploy:vps
```

[`deploy-vps.sh`](../deploy-vps.sh) 會：

1. SSH 到 VPS 讀取 `nvm/default` 的 Node.js 版本。
2. 本機切換到同一個 Node.js 版本後執行 `npm ci` 與 `npm run build`。
3. 同步專案檔案與 `.next` 到 VPS，但排除 `.env*`、SQLite `.db`、`node_modules`、Docker 檔案與備份目錄。
4. 在 VPS 用同一個 Node.js 版本執行 [`setup-production.sh`](../setup-production.sh)。
5. 在 VPS 執行 `npm ci --omit=dev`、`npx prisma generate`，暫停既有 PM2 App 釋放 SQLite lock，再執行 `npx prisma migrate deploy`。
6. 用 [`ecosystem.config.cjs`](../ecosystem.config.cjs) 啟動或 reload PM2，並把 PM2 綁定到 VPS 當前 `node` binary。
7. 執行 `http://127.0.0.1:3000/api/health` 健康檢查。

若 `prisma migrate deploy` 失敗，部署腳本預設會中止，避免未確認地繞過 migration history。只有在已確認正式資料庫 schema 可直接同步時，才使用：

```bash
ALLOW_PRISMA_DB_PUSH_FALLBACK=1 VPS_HOST=YOUR_DROPLET_IP npm run deploy:vps
```

## 4. PM2 開機自動啟動

首次成功部署後，在 VPS 執行 [`setup-production.sh`](../setup-production.sh) 輸出的 `pm2 startup` 指令，例如：

```bash
sudo env PATH=/home/deploy/.nvm/versions/node/v20.19.6/bin:$PATH /home/deploy/.nvm/versions/node/v20.19.6/bin/pm2 startup systemd -u deploy --hp /home/deploy
pm2 save
```

檢查 PM2 狀態：

```bash
pm2 status attendance
pm2 logs attendance --lines 50 --nostream
```

## 5. Nginx 反向代理

建立 `/etc/nginx/sites-available/attendance`：

```nginx
server {
    listen 80;
    server_name your-domain.example;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
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

啟用站台：

```bash
sudo ln -s /etc/nginx/sites-available/attendance /etc/nginx/sites-enabled/attendance
sudo nginx -t
sudo systemctl reload nginx
```

若使用 Cloudflare Full/Strict，請搭配 [`docs/CLOUDFLARE_DEPLOYMENT_GUIDE.md`](CLOUDFLARE_DEPLOYMENT_GUIDE.md) 設定 Origin Certificate；若不用 Cloudflare，可使用 Let's Encrypt：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
```

## 6. 驗證與日常更新

部署後驗證：

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://your-domain.example/api/health
pm2 show attendance
```

日常更新：

```bash
VPS_HOST=YOUR_DROPLET_IP npm run deploy:vps
```

若升級 VPS Node.js：

```bash
. /home/deploy/.nvm/nvm.sh
nvm install 22
nvm alias default 22
nvm use default
node -v
npm install -g pm2
```

然後從本機重新部署：

```bash
VPS_HOST=YOUR_DROPLET_IP npm run deploy:vps
```

## 7. 回滾

若新版本異常：

```bash
cd /home/deploy/apps/changfu-attendance
pm2 logs attendance --lines 100 --nostream
pm2 restart attendance
```

若需要回到上一個 Git commit，請在本機切回上一版後重新部署：

```bash
git checkout PREVIOUS_COMMIT
VPS_HOST=YOUR_DROPLET_IP npm run deploy:vps
```

SQLite 回滾需先停止服務並還原備份：

```bash
pm2 stop attendance
cp /path/to/backup/prod.db /home/deploy/apps/changfu-attendance/prisma/prod.db
pm2 start attendance
```
