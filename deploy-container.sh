#!/bin/bash
# deploy-container.sh - 一鍵容器化部署腳本

set -e  # 遇到錯誤立即停止

echo "🚀 開始容器化部署長福會考勤系統..."

# 顯示系統資訊
echo "📊 系統資訊："
echo "  - 操作系統: $(uname -s)"
echo "  - 架構: $(uname -m)"
echo "  - 時間: $(date)"

# 檢查 Docker
echo "🐳 檢查 Docker 環境..."
if ! command -v docker &> /dev/null; then
    echo "❌ 請先安裝 Docker"
    echo "📋 安裝指南: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ 請先安裝 Docker Compose"
    echo "📋 安裝指南: https://docs.docker.com/compose/install/"
    exit 1
fi

# 確定 Docker Compose 命令
DOCKER_COMPOSE_CMD="docker-compose"
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
fi

echo "✅ Docker 環境檢查通過"
echo "  - Docker 版本: $(docker --version)"
echo "  - Compose 版本: $($DOCKER_COMPOSE_CMD --version)"

# 設定生產環境
echo "📁 設定生產環境..."
if [ ! -f "./setup-production.sh" ]; then
    echo "❌ 找不到 setup-production.sh 腳本"
    exit 1
fi

chmod +x setup-production.sh
./setup-production.sh

# 檢查必要檔案
echo "📋 檢查必要檔案..."
REQUIRED_FILES=(
    "Dockerfile.optimized"
    "docker-compose.production.yml"
    "secrets/jwt_secret.txt"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ 找不到必要檔案: $file"
        exit 1
    fi
done
echo "✅ 必要檔案檢查通過"

# 檢查磁碟空間
echo "💾 檢查磁碟空間..."
AVAILABLE_SPACE=$(df . | awk 'NR==2 {print $4}')
REQUIRED_SPACE=2097152  # 2GB in KB
if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_SPACE" ]; then
    echo "⚠️ 磁碟空間不足，建議至少有 2GB 可用空間"
    echo "💾 目前可用: $(echo "scale=2; $AVAILABLE_SPACE/1024/1024" | bc)GB"
    read -p "是否繼續部署？(y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 停止舊容器
echo "🛑 停止舊容器..."
$DOCKER_COMPOSE_CMD -f docker-compose.production.yml down --remove-orphans 2>/dev/null || echo "  沒有運行中的容器"

# 清理舊映像（可選）
read -p "🧹 是否清理舊 Docker 映像？(y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧹 清理舊映像..."
    docker system prune -f
    docker image prune -f
fi

# 構建映像
echo "🔨 構建 Docker 映像..."
echo "  這可能需要幾分鐘時間，請耐心等待..."
$DOCKER_COMPOSE_CMD -f docker-compose.production.yml build --no-cache --progress=plain

# 檢查構建結果
if [ $? -ne 0 ]; then
    echo "❌ Docker 映像構建失敗"
    exit 1
fi
echo "✅ Docker 映像構建成功"

# 啟動新容器
echo "▶️ 啟動新容器..."
$DOCKER_COMPOSE_CMD -f docker-compose.production.yml up -d

# 檢查啟動結果
if [ $? -ne 0 ]; then
    echo "❌ 容器啟動失敗"
    echo "📄 檢查日誌: $DOCKER_COMPOSE_CMD -f docker-compose.production.yml logs"
    exit 1
fi

# 等待服務啟動
echo "⏳ 等待服務啟動..."
sleep 15

# 顯示容器狀態
echo "📊 容器狀態："
$DOCKER_COMPOSE_CMD -f docker-compose.production.yml ps

# 健康檢查
echo "🔍 執行健康檢查..."
HEALTH_CHECK_ATTEMPTS=10
HEALTH_CHECK_INTERVAL=10

for i in $(seq 1 $HEALTH_CHECK_ATTEMPTS); do
    echo "  嘗試 $i/$HEALTH_CHECK_ATTEMPTS..."
    
    # 檢查容器是否運行
    if ! $DOCKER_COMPOSE_CMD -f docker-compose.production.yml ps | grep -q "Up"; then
        echo "  ❌ 容器未運行"
        break
    fi
    
    # 檢查健康端點
    if curl -f -s http://localhost:3001/api/health >/dev/null 2>&1; then
        echo "  ✅ 健康檢查通過！"
        HEALTH_OK=true
        break
    elif curl -f -s http://localhost/health >/dev/null 2>&1; then
        echo "  ✅ 健康檢查通過（通過 Nginx）！"
        HEALTH_OK=true
        break
    fi
    
    if [ $i -lt $HEALTH_CHECK_ATTEMPTS ]; then
        echo "  ⏳ 等待服務準備就緒..."
        sleep $HEALTH_CHECK_INTERVAL
    fi
done

# 顯示部署結果
echo ""
echo "======================================="
if [ "${HEALTH_OK:-false}" = "true" ]; then
    echo "🎉 部署成功！"
    echo ""
    echo "📱 應用程式網址:"
    echo "  - 直接存取: http://localhost:3001"
    echo "  - 透過 Nginx: http://localhost"
    echo ""
    echo "🔍 服務狀態:"
    $DOCKER_COMPOSE_CMD -f docker-compose.production.yml ps --format "table"
else
    echo "⚠️ 部署完成但服務可能未完全啟動"
    echo ""
    echo "🔧 故障排除："
    echo "  1. 檢查容器日誌: $DOCKER_COMPOSE_CMD -f docker-compose.production.yml logs -f"
    echo "  2. 檢查容器狀態: $DOCKER_COMPOSE_CMD -f docker-compose.production.yml ps"
    echo "  3. 重新啟動: $DOCKER_COMPOSE_CMD -f docker-compose.production.yml restart"
fi

echo ""
echo "📋 常用管理命令："
echo "  查看日誌: $DOCKER_COMPOSE_CMD -f docker-compose.production.yml logs -f [service_name]"
echo "  停止服務: $DOCKER_COMPOSE_CMD -f docker-compose.production.yml down"
echo "  重新啟動: $DOCKER_COMPOSE_CMD -f docker-compose.production.yml restart"
echo "  更新映像: $DOCKER_COMPOSE_CMD -f docker-compose.production.yml pull && $DOCKER_COMPOSE_CMD -f docker-compose.production.yml up -d"
echo ""
echo "📁 重要目錄："
echo "  - 生產資料庫: ./data/production/"
echo "  - 上傳檔案: ./uploads/production/"
echo "  - 自動備份: ./backups/"
echo ""
echo "🔧 如需協助，請檢查 CONTAINER_DEPLOYMENT_GUIDE.md"
echo "======================================="
