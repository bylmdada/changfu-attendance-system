# 長福會考勤系統 - 容器部署指南 🐳

## 📋 部署問題分析與解決方案

### 🔍 發現的問題

#### 1. **Dockerfile 優化問題**
```dockerfile
# 當前問題：單階段構建，生產環境包含開發依賴
FROM node:18-alpine
RUN npm ci --only=production  # 問題：會缺少構建依賴
```

#### 2. **數據持久化問題**
- SQLite 資料庫文件需要持久化掛載
- 上傳檔案目錄需要確保權限正確
- 資料庫初始化和遷移問題

#### 3. **環境變數安全性**
- JWT_SECRET 明碼暴露
- 缺少健康檢查配置
- 網路安全設定不足

#### 4. **HTTPS/SSL 配置**
- 生產環境需要 SSL 證書
- 反向代理配置
- 域名和證書管理

---

## 🛠️ 改進建議與解決方案

### 🔧 1. 多階段 Dockerfile 優化

```dockerfile
# ===== 第一階段：構建階段 =====
FROM node:18-alpine AS builder
WORKDIR /app

# 複製 package 檔案
COPY package*.json ./
COPY prisma/ ./prisma/

# 安裝所有依賴（包含 devDependencies）
RUN npm ci

# 複製源碼
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 構建應用程式
RUN npm run build

# ===== 第二階段：運行階段 =====
FROM node:18-alpine AS runner
WORKDIR /app

# 創建非 root 用戶
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 複製必要文件
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# 複製構建結果
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 安裝生產依賴
RUN npm ci --only=production && npm cache clean --force

# 創建必要目錄並設定權限
RUN mkdir -p data uploads/announcements
RUN chown -R nextjs:nodejs data uploads

# 切換到非 root 用戶
USER nextjs

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

### 🔄 2. 增強版 Docker Compose

```yaml
# docker-compose.production.yml
version: '3.8'

services:
  # 主應用服務
  attendance-app:
    build:
      context: .
      dockerfile: Dockerfile
      target: runner
    container_name: changfu-attendance
    restart: unless-stopped
    
    ports:
      - "3001:3001"
    
    environment:
      - NODE_ENV=production
      - DATABASE_URL=file:./data/database.db
      - JWT_SECRET_FILE=/run/secrets/jwt_secret
      - TZ=Asia/Taipei
    
    volumes:
      # 資料庫持久化
      - attendance_data:/app/data
      # 上傳檔案持久化
      - attendance_uploads:/app/uploads
      # SSL 證書（如果使用）
      - ./certs:/app/certs:ro
    
    secrets:
      - jwt_secret
    
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
    
    depends_on:
      - nginx
    
    networks:
      - attendance_network

  # Nginx 反向代理
  nginx:
    image: nginx:alpine
    container_name: changfu-nginx
    restart: unless-stopped
    
    ports:
      - "80:80"
      - "443:443"
    
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certs:/etc/nginx/certs:ro
      - nginx_logs:/var/log/nginx
    
    depends_on:
      - attendance-app
    
    networks:
      - attendance_network

  # 資料庫備份服務
  db-backup:
    image: alpine:latest
    container_name: changfu-backup
    restart: "no"
    
    volumes:
      - attendance_data:/data:ro
      - backup_storage:/backup
    
    command: >
      sh -c "
        while true; do
          timestamp=$$(date +%Y%m%d_%H%M%S)
          cp /data/database.db /backup/database_backup_$$timestamp.db
          find /backup -name 'database_backup_*.db' -mtime +7 -delete
          sleep 86400
        done
      "
    
    networks:
      - attendance_network

# 網路配置
networks:
  attendance_network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

# 數據卷配置
volumes:
  attendance_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ./data/production
  
  attendance_uploads:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ./uploads/production
  
  backup_storage:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ./backups
  
  nginx_logs:
    driver: local

# 機密配置
secrets:
  jwt_secret:
    file: ./secrets/jwt_secret.txt
```

### 🌐 3. Nginx 配置

```nginx
# nginx/nginx.conf
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
```

```nginx
# nginx/conf.d/attendance.conf
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    
    # HTTP 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;
    
    # SSL 配置
    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:MozTLS:10m;
    ssl_session_tickets off;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # 安全標頭
    add_header Strict-Transport-Security "max-age=63072000" always;
    
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
```

### 🔒 4. 安全配置腳本

```bash
#!/bin/bash
# setup-production.sh

echo "🔧 設定生產環境容器部署..."

# 創建目錄結構
mkdir -p {data/production,uploads/production,backups,secrets,certs,nginx/conf.d}

# 生成 JWT Secret
if [ ! -f "./secrets/jwt_secret.txt" ]; then
    echo "🔐 生成 JWT Secret..."
    openssl rand -base64 64 > ./secrets/jwt_secret.txt
    chmod 600 ./secrets/jwt_secret.txt
    echo "✅ JWT Secret 已生成"
fi

# 設定目錄權限
echo "🛡️ 設定目錄權限..."
chmod 700 ./secrets
chmod 755 ./data/production ./uploads/production ./backups
chmod 644 ./nginx/conf.d/*.conf 2>/dev/null || true

# 創建 .env 檔案
if [ ! -f ".env.production" ]; then
    cat > .env.production << EOF
NODE_ENV=production
DATABASE_URL=file:./data/database.db
PORT=3001
TZ=Asia/Taipei
NEXT_TELEMETRY_DISABLED=1
EOF
    echo "✅ 環境變數檔案已創建"
fi

# 初始化資料庫
echo "🗄️ 初始化生產資料庫..."
if [ ! -f "./data/production/database.db" ]; then
    # 複製開發資料庫或創建新的
    if [ -f "./prisma/dev.db" ]; then
        cp ./prisma/dev.db ./data/production/database.db
        echo "✅ 開發資料庫已複製到生產環境"
    else
        # 創建空資料庫並運行遷移
        touch ./data/production/database.db
        echo "✅ 新生產資料庫已創建"
    fi
fi

echo "🎉 生產環境設定完成！"
echo ""
echo "下一步："
echo "1. 設定 SSL 證書（放在 ./certs/ 目錄）"
echo "2. 修改 nginx 配置中的域名"
echo "3. 運行: docker-compose -f docker-compose.production.yml up -d"
```

### 🚀 5. 一鍵部署腳本

```bash
#!/bin/bash
# deploy-container.sh

set -e  # 遇到錯誤立即停止

echo "🚀 開始容器化部署長福會考勤系統..."

# 檢查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 請先安裝 Docker"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ 請先安裝 Docker Compose"
    exit 1
fi

# 設定生產環境
echo "📁 設定生產環境..."
chmod +x setup-production.sh
./setup-production.sh

# 構建映像
echo "🔨 構建 Docker 映像..."
docker-compose -f docker-compose.production.yml build --no-cache

# 停止舊容器
echo "🛑 停止舊容器..."
docker-compose -f docker-compose.production.yml down

# 啟動新容器
echo "▶️ 啟動新容器..."
docker-compose -f docker-compose.production.yml up -d

# 等待服務啟動
echo "⏳ 等待服務啟動..."
sleep 30

# 健康檢查
echo "🔍 執行健康檢查..."
for i in {1..5}; do
    if curl -f http://localhost:3001/api/health >/dev/null 2>&1; then
        echo "✅ 服務運行正常！"
        break
    fi
    echo "⏳ 等待服務啟動... ($i/5)"
    sleep 10
done

# 顯示狀態
echo "📊 容器狀態："
docker-compose -f docker-compose.production.yml ps

echo ""
echo "🎉 部署完成！"
echo "📱 應用程式網址: http://localhost:3001"
echo "📄 查看日誌: docker-compose -f docker-compose.production.yml logs -f"
echo "🔧 管理容器: docker-compose -f docker-compose.production.yml [up|down|restart]"
```

---

## 🌟 其他重要建議

### 📊 1. 監控與日誌
- 使用 Prometheus + Grafana 監控
- ELK Stack 集中式日誌管理
- 應用程式效能監控 (APM)

### 🔄 2. CI/CD 整合
- GitHub Actions 自動化部署
- 自動化測試管道
- 容器掃描安全檢查

### 💾 3. 資料備份策略
- 自動化資料庫備份
- 增量備份機制
- 災難恢復計畫

### 🌐 4. 雲端部署選項
- **AWS ECS/Fargate**: 無伺服器容器
- **Google Cloud Run**: 自動擴縮容器
- **Azure Container Instances**: 簡化容器管理
- **DigitalOcean App Platform**: 經濟實惠選擇

### ⚖️ 5. 擴展性考量
- 水平擴展配置
- 負載均衡設定
- 資料庫優化
- CDN 整合

---

## 📞 需要協助？

如果在部署過程中遇到問題：

1. **檢查日誌**: `docker-compose logs attendance-app`
2. **容器狀態**: `docker-compose ps`
3. **進入容器**: `docker-compose exec attendance-app sh`
4. **資料庫連線**: 確認 DATABASE_URL 正確性
5. **網路連線**: 檢查防火牆和端口配置

**記住：生產環境部署需要仔細測試每個步驟！** 🎯
