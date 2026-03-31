#!/bin/bash
set -euo pipefail

# === 長福會考勤系統 - VPS 部署腳本 ===

DEPLOY_PATH="/opt/changfu-attendance"
IMAGE_NAME="changfu-attendance"
COMPOSE_FILE="docker-compose.production.yml"

cd "$DEPLOY_PATH"

echo "=== 開始部署長福會考勤系統 ==="

# 1. 建立必要目錄
echo "[1/6] 建立必要目錄..."
mkdir -p data/production uploads/production backups secrets certs nginx/conf.d

# 2. 初始化 secrets（首次部署時）
if [ ! -f secrets/jwt_secret.txt ]; then
  echo "[INFO] 初次部署，生成 JWT Secret..."
  openssl rand -base64 48 > secrets/jwt_secret.txt
  chmod 600 secrets/jwt_secret.txt
fi

# 3. 初始化 nginx 設定（首次部署時）
if [ ! -f nginx/conf.d/default.conf ]; then
  echo "[INFO] 初次部署，建立 Nginx 設定..."
  cat > nginx/conf.d/default.conf << 'NGINX_EOF'
upstream attendance_app {
    server attendance-app:3001;
}

server {
    listen 80;
    server_name _;

    client_max_body_size 10M;

    location / {
        proxy_pass http://attendance_app;
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
NGINX_EOF
fi

if [ ! -f nginx/nginx.conf ]; then
  cat > nginx/nginx.conf << 'NGINX_MAIN_EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    sendfile on;
    keepalive_timeout 65;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    include /etc/nginx/conf.d/*.conf;
}
NGINX_MAIN_EOF
fi

# 4. 載入 Docker image
echo "[2/6] 載入 Docker image..."
docker load < image.tar.gz
rm -f image.tar.gz

# 5. 備份現有資料庫
if [ -f data/production/database.db ]; then
  echo "[3/6] 備份資料庫..."
  BACKUP_NAME="database_pre_deploy_$(date +%Y%m%d_%H%M%S).db"
  cp data/production/database.db "backups/$BACKUP_NAME"
  echo "[INFO] 備份完成: backups/$BACKUP_NAME"
else
  echo "[3/6] 無現有資料庫，跳過備份"
fi

# 6. 停止舊容器
echo "[4/6] 停止舊容器..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

# 7. 啟動新容器
echo "[5/6] 啟動新容器..."
docker compose -f "$COMPOSE_FILE" up -d

# 8. 執行資料庫遷移
echo "[6/6] 執行資料庫遷移..."
docker exec changfu-attendance npx prisma migrate deploy 2>/dev/null || \
  docker exec changfu-attendance npx prisma db push 2>/dev/null || \
  echo "[WARN] 資料庫遷移跳過（可能尚未設定 migrations）"

# 9. 健康檢查
echo "=== 等待健康檢查..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "=== 部署成功！應用已在 port 3001 運行 ==="
    docker compose -f "$COMPOSE_FILE" ps
    exit 0
  fi
  sleep 2
done

echo "=== [ERROR] 健康檢查失敗，查看日誌 ==="
docker compose -f "$COMPOSE_FILE" logs --tail=50
exit 1
