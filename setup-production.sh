#!/bin/bash
# setup-production.sh - 生產環境設定腳本

set -e  # 遇到錯誤立即停止

echo "🔧 設定長福會考勤系統生產環境..."

# 創建目錄結構
echo "📁 創建目錄結構..."
mkdir -p {data/production,uploads/production,backups,secrets,certs,nginx/conf.d}

# 生成 JWT Secret
if [ ! -f "./secrets/jwt_secret.txt" ]; then
    echo "🔐 生成 JWT Secret..."
    openssl rand -base64 64 > ./secrets/jwt_secret.txt
    chmod 600 ./secrets/jwt_secret.txt
    echo "✅ JWT Secret 已生成"
else
    echo "✅ JWT Secret 已存在"
fi

# 設定目錄權限
echo "🛡️ 設定目錄權限..."
chmod 700 ./secrets
chmod 755 ./data/production ./uploads/production ./backups
chmod 644 ./nginx/conf.d/*.conf 2>/dev/null || echo "📝 Nginx 配置檔案將稍後創建"

# 創建 .env 檔案
if [ ! -f ".env.production" ]; then
    cat > .env.production << 'EOF'
NODE_ENV=production
DATABASE_URL=file:./data/database.db
PORT=3001
TZ=Asia/Taipei
NEXT_TELEMETRY_DISABLED=1
EOF
    echo "✅ 環境變數檔案已創建"
else
    echo "✅ 環境變數檔案已存在"
fi

# 初始化資料庫
echo "🗄️ 初始化生產資料庫..."
if [ ! -f "./data/production/database.db" ]; then
    # 複製開發資料庫或創建新的
    if [ -f "./prisma/dev.db" ]; then
        cp ./prisma/dev.db ./data/production/database.db
        echo "✅ 開發資料庫已複製到生產環境"
    else
        # 創建空資料庫
        touch ./data/production/database.db
        echo "✅ 新生產資料庫已創建（需要運行遷移）"
    fi
else
    echo "✅ 生產資料庫已存在"
fi

# 創建 Nginx 配置
if [ ! -f "./nginx/nginx.conf" ]; then
    echo "🌐 創建 Nginx 主配置..."
    cat > ./nginx/nginx.conf << 'EOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log notice;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # 日誌格式
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                   '$status $body_bytes_sent "$http_referer" '
                   '"$http_user_agent" "$http_x_forwarded_for"';
    
    access_log /var/log/nginx/access.log main;
    
    # 基本設定
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;
    
    # Gzip 壓縮
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/xml+rss
        application/json;
    
    # 安全標頭
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    
    # 包含站點配置
    include /etc/nginx/conf.d/*.conf;
}
EOF
    echo "✅ Nginx 主配置已創建"
fi

if [ ! -f "./nginx/conf.d/attendance.conf" ]; then
    echo "🌐 創建 Nginx 站點配置..."
    cat > ./nginx/conf.d/attendance.conf << 'EOF'
server {
    listen 80;
    server_name localhost;
    
    # 上傳大小限制
    client_max_body_size 50M;
    
    # 代理配置
    location / {
        proxy_pass http://attendance-app:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超時設定
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # 靜態資源快取
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        proxy_pass http://attendance-app:3001;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # 健康檢查
    location /health {
        proxy_pass http://attendance-app:3001/api/health;
        access_log off;
    }
}

# HTTPS 配置（需要 SSL 證書）
# server {
#     listen 443 ssl http2;
#     server_name your-domain.com www.your-domain.com;
#     
#     # SSL 配置
#     ssl_certificate /etc/nginx/certs/fullchain.pem;
#     ssl_certificate_key /etc/nginx/certs/privkey.pem;
#     ssl_session_timeout 1d;
#     ssl_session_cache shared:MozTLS:10m;
#     ssl_session_tickets off;
#     
#     ssl_protocols TLSv1.2 TLSv1.3;
#     ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
#     ssl_prefer_server_ciphers off;
#     
#     # 安全標頭
#     add_header Strict-Transport-Security "max-age=63072000" always;
#     
#     # 其他配置與上方相同...
# }
EOF
    echo "✅ Nginx 站點配置已創建"
fi

# 創建健康檢查 API
if [ ! -f "./src/app/api/health/route.ts" ]; then
    echo "🏥 創建健康檢查 API..."
    mkdir -p ./src/app/api/health
    cat > ./src/app/api/health/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    // 檢查資料庫連線
    await prisma.$queryRaw`SELECT 1`;
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
EOF
    echo "✅ 健康檢查 API 已創建"
fi

echo ""
echo "🎉 生產環境設定完成！"
echo ""
echo "📋 下一步："
echo "1. 檢查 JWT Secret: cat ./secrets/jwt_secret.txt"
echo "2. 修改 Nginx 配置域名（如需要）"
echo "3. 設定 SSL 證書（放在 ./certs/ 目錄）"
echo "4. 運行部署: chmod +x deploy-container.sh && ./deploy-container.sh"
echo ""
echo "📁 目錄結構："
echo "  ├── data/production/     # 生產資料庫"
echo "  ├── uploads/production/  # 生產上傳檔案"
echo "  ├── backups/            # 自動備份"
echo "  ├── secrets/            # JWT Secret"
echo "  ├── certs/              # SSL 證書"
echo "  └── nginx/              # Nginx 配置"
