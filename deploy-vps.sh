#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-deploy}"
VPS_PORT="${VPS_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/${VPS_USER}/apps/changfu-attendance}"
PM2_APP_NAME="${PM2_APP_NAME:-attendance}"
APP_PORT="${APP_PORT:-3000}"
APP_HOST="${APP_HOST:-0.0.0.0}"
LOCAL_ENV_FILE="${LOCAL_ENV_FILE:-.env.production}"
REMOTE_ENV_FILE="${REMOTE_ENV_FILE:-.env.production}"
SSH_COMMON_OPTS=(-p "$VPS_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=6)
RSYNC_RSH="ssh -p ${VPS_PORT} -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=6"

if [[ -z "$VPS_HOST" ]]; then
  echo "❌ 請先設定 VPS_HOST，例如：VPS_HOST=203.0.113.10 ./deploy-vps.sh"
  exit 1
fi

if [[ ! -f package.json ]]; then
  echo "❌ 請在專案根目錄執行此腳本"
  exit 1
fi

ssh_remote() {
  ssh "${SSH_COMMON_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" "$@"
}

echo "=== 取得 VPS Node 版本 ==="
REMOTE_NODE_VERSION="$(
  ssh_remote '
    set -e
    export NVM_DIR="$HOME/.nvm"
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
      echo "missing-nvm"
      exit 11
    fi
    . "$NVM_DIR/nvm.sh"
    node -v
  '
)"

if [[ "$REMOTE_NODE_VERSION" == "missing-nvm" ]]; then
  echo "❌ VPS 尚未安裝 nvm，請先在 VPS 完成 nvm / Node 安裝"
  exit 1
fi

REMOTE_NODE_VERSION="${REMOTE_NODE_VERSION#v}"

echo "=== 切換本機 Node 版本到 ${REMOTE_NODE_VERSION} ==="
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm install "$REMOTE_NODE_VERSION" >/dev/null
  nvm use "$REMOTE_NODE_VERSION" >/dev/null

  echo "=== 本機安裝依賴與建置 ==="
  npm ci
  npm run build
elif [[ "$(node -v 2>/dev/null || true)" == "v${REMOTE_NODE_VERSION}" ]]; then
  echo "=== 本機已是相同 Node 版本，直接建置 ==="
  npm ci
  npm run build
else
  echo "=== 本機沒有 nvm，改用暫時的 Node ${REMOTE_NODE_VERSION} 建置 ==="
  npx -y -p "node@${REMOTE_NODE_VERSION}" -p "npm@10" -c 'npm ci && npm run build'
fi

echo "=== 建立 VPS 目錄 ==="
ssh_remote "
  set -e
  mkdir -p '$DEPLOY_PATH' '$DEPLOY_PATH/backups'
  if [ -d '$DEPLOY_PATH/prisma/prisma' ]; then
    mv '$DEPLOY_PATH/prisma/prisma' '$DEPLOY_PATH/backups/prisma-nested-'\"\$(date +%Y%m%d_%H%M%S)\"
  fi
"

echo "=== 同步專案檔案到 VPS ==="
rsync -az --delete \
  --partial \
  -e "$RSYNC_RSH" \
  --exclude '.git/' \
  --exclude '.github/' \
  --exclude '.next/' \
  --exclude 'node_modules/' \
  --exclude 'uploads/' \
  --exclude 'data/' \
  --exclude 'backups/' \
  --exclude 'certs/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'prisma/*.db*' \
  --exclude 'Dockerfile' \
  --exclude 'Dockerfile.optimized' \
  --exclude 'docker-compose*.yml' \
  --exclude 'tsconfig.tsbuildinfo' \
  ./ "${VPS_USER}@${VPS_HOST}:${DEPLOY_PATH}/"

echo "=== 同步 Next build 產物 ==="
rsync -az --delete \
  --partial \
  -e "$RSYNC_RSH" \
  .next/ "${VPS_USER}@${VPS_HOST}:${DEPLOY_PATH}/.next/"

if [[ -f "$LOCAL_ENV_FILE" ]]; then
  echo "=== 同步 ${LOCAL_ENV_FILE} 到 VPS ==="
  rsync -az \
    -e "$RSYNC_RSH" \
    "$LOCAL_ENV_FILE" "${VPS_USER}@${VPS_HOST}:${DEPLOY_PATH}/${REMOTE_ENV_FILE}"
else
  echo "=== 略過環境檔同步（本機未找到 ${LOCAL_ENV_FILE}） ==="
fi

echo "=== 在 VPS 安裝依賴、更新 Prisma、重啟 PM2 ==="
ssh_remote "
  set -euo pipefail
  export NVM_DIR=\"\$HOME/.nvm\"
  . \"\$NVM_DIR/nvm.sh\"
  nvm use ${REMOTE_NODE_VERSION} >/dev/null
  cd '$DEPLOY_PATH'
  chmod +x setup-production.sh
  PM2_APP_NAME='${PM2_APP_NAME}' APP_PORT='${APP_PORT}' APP_HOST='${APP_HOST}' ENV_FILE='${REMOTE_ENV_FILE}' ./setup-production.sh
  npm ci --omit=dev
  npx prisma generate
  npx prisma migrate deploy || npx prisma db push
  if pm2 describe '${PM2_APP_NAME}' >/dev/null 2>&1; then
    PM2_APP_NAME='${PM2_APP_NAME}' PORT='${APP_PORT}' HOSTNAME='${APP_HOST}' TZ='Asia/Taipei' NEXT_TELEMETRY_DISABLED='1' pm2 startOrReload ecosystem.config.cjs --update-env
  else
    PM2_APP_NAME='${PM2_APP_NAME}' PORT='${APP_PORT}' HOSTNAME='${APP_HOST}' TZ='Asia/Taipei' NEXT_TELEMETRY_DISABLED='1' pm2 start ecosystem.config.cjs --update-env
  fi
  pm2 save
  sleep 5
  pm2 status '${PM2_APP_NAME}'
  echo '=== 健康檢查 ==='
  curl -fsS 'http://127.0.0.1:${APP_PORT}/api/health'
"

echo "=== 部署完成 ==="
