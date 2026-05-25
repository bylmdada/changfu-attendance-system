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
MIN_NODE_VERSION="${MIN_NODE_VERSION:-20.19.6}"
MAX_NODE_MAJOR="${MAX_NODE_MAJOR:-23}"
EXPECTED_NODE_VERSION="${EXPECTED_NODE_VERSION:-}"
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

version_ge() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

version_lt() {
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" == "$1" && "$1" != "$2" ]]
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
    if ! command -v node >/dev/null 2>&1; then
      DEFAULT_NODE_VERSION="$(nvm version default || true)"
      if [ -n "$DEFAULT_NODE_VERSION" ] && [ "$DEFAULT_NODE_VERSION" != "N/A" ]; then
        nvm use default >/dev/null
      fi
    fi
    if ! command -v node >/dev/null 2>&1; then
      echo "missing-node"
      exit 12
    fi
    node -v
  '
)"

if [[ "$REMOTE_NODE_VERSION" == "missing-nvm" ]]; then
  echo "❌ VPS 尚未安裝 nvm，請先在 VPS 完成 nvm / Node 安裝"
  exit 1
fi
if [[ "$REMOTE_NODE_VERSION" == "missing-node" ]]; then
  echo "❌ VPS nvm 尚未設定可用 Node，請先在 VPS 執行 nvm install <版本> && nvm alias default <版本>"
  exit 1
fi

REMOTE_NODE_VERSION="${REMOTE_NODE_VERSION#v}"
TARGET_NODE_VERSION="${EXPECTED_NODE_VERSION:-$REMOTE_NODE_VERSION}"

if [[ -n "$EXPECTED_NODE_VERSION" && "$REMOTE_NODE_VERSION" != "$EXPECTED_NODE_VERSION" ]]; then
  echo "=== VPS 目前 Node 版本為 ${REMOTE_NODE_VERSION}，將依 EXPECTED_NODE_VERSION 切換為 ${EXPECTED_NODE_VERSION} ==="
else
  echo "=== 使用 VPS 目前 Node 版本 ${TARGET_NODE_VERSION} 進行本機建置與 PM2 reload ==="
fi

if ! version_ge "$TARGET_NODE_VERSION" "$MIN_NODE_VERSION"; then
  echo "❌ 目標 Node 版本為 ${TARGET_NODE_VERSION}，正式環境至少需要 ${MIN_NODE_VERSION}"
  exit 1
fi
if ! version_lt "$TARGET_NODE_VERSION" "$MAX_NODE_MAJOR"; then
  echo "❌ 目標 Node 版本為 ${TARGET_NODE_VERSION}，但 package.json 支援範圍為 <${MAX_NODE_MAJOR}"
  exit 1
fi

echo "=== 切換本機 Node 版本到 ${TARGET_NODE_VERSION} ==="
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm install "$TARGET_NODE_VERSION" >/dev/null
  nvm use "$TARGET_NODE_VERSION" >/dev/null

  echo "=== 本機安裝依賴與建置 ==="
  npm ci
  npm run build
elif [[ "$(node -v 2>/dev/null || true)" == "v${TARGET_NODE_VERSION}" ]]; then
  echo "=== 本機已是相同 Node 版本，直接建置 ==="
  npm ci
  npm run build
else
  echo "=== 本機沒有 nvm，改用暫時的 Node ${TARGET_NODE_VERSION} 建置 ==="
  npx -y -p "node@${TARGET_NODE_VERSION}" -p "npm@10" -c 'npm ci && npm run build'
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
  --rsh="$RSYNC_RSH" \
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
  --rsh="$RSYNC_RSH" \
  .next/ "${VPS_USER}@${VPS_HOST}:${DEPLOY_PATH}/.next/"

if [[ -f "$LOCAL_ENV_FILE" ]]; then
  echo "=== 同步 ${LOCAL_ENV_FILE} 到 VPS ==="
  rsync -az \
    --rsh="$RSYNC_RSH" \
    "$LOCAL_ENV_FILE" "${VPS_USER}@${VPS_HOST}:${DEPLOY_PATH}/${REMOTE_ENV_FILE}"
else
  echo "=== 略過環境檔同步（本機未找到 ${LOCAL_ENV_FILE}） ==="
fi

echo "=== 在 VPS 安裝依賴、更新 Prisma、重啟 PM2 ==="
ssh_remote "
  set -euo pipefail
  export NVM_DIR=\"\$HOME/.nvm\"
  . \"\$NVM_DIR/nvm.sh\"
  nvm install ${TARGET_NODE_VERSION} >/dev/null
  nvm use ${TARGET_NODE_VERSION} >/dev/null
  NODE_BINARY=\"\$(command -v node)\"
  cd '$DEPLOY_PATH'
  printf '%s\n' '${TARGET_NODE_VERSION}' > .nvmrc
  chmod +x setup-production.sh
  EXPECTED_NODE_VERSION='${TARGET_NODE_VERSION}' PM2_APP_NAME='${PM2_APP_NAME}' APP_PORT='${APP_PORT}' APP_HOST='${APP_HOST}' ENV_FILE='${REMOTE_ENV_FILE}' ./setup-production.sh
  PM2_BINARY=\"\$(command -v pm2)\"
  npm ci --omit=dev
  npx prisma generate
  npx prisma migrate deploy || npx prisma db push
  CURRENT_PM2_SCRIPT=\"\"
  if \"\$PM2_BINARY\" describe '${PM2_APP_NAME}' >/dev/null 2>&1; then
    CURRENT_PM2_SCRIPT=\"\$(\"\$PM2_BINARY\" jlist | \"\$NODE_BINARY\" -e \"let input=''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const app = JSON.parse(input).find((item) => item.name === '${PM2_APP_NAME}'); process.stdout.write(app?.pm2_env?.pm_exec_path || ''); });\")\"
  fi
  if [[ -n \"\$CURRENT_PM2_SCRIPT\" && \"\$CURRENT_PM2_SCRIPT\" != \"\$NODE_BINARY\" ]]; then
    echo \"=== PM2 程序仍使用舊啟動器，重新建立 ${PM2_APP_NAME} ===\"
    \"\$PM2_BINARY\" delete '${PM2_APP_NAME}'
  fi
  if \"\$PM2_BINARY\" describe '${PM2_APP_NAME}' >/dev/null 2>&1; then
    PM2_APP_NAME='${PM2_APP_NAME}' PORT='${APP_PORT}' HOSTNAME='${APP_HOST}' TZ='Asia/Taipei' NEXT_TELEMETRY_DISABLED='1' NODE_BINARY=\"\$NODE_BINARY\" APP_NODE_VERSION='${TARGET_NODE_VERSION}' \"\$PM2_BINARY\" startOrReload ecosystem.config.cjs --update-env
  else
    PM2_APP_NAME='${PM2_APP_NAME}' PORT='${APP_PORT}' HOSTNAME='${APP_HOST}' TZ='Asia/Taipei' NEXT_TELEMETRY_DISABLED='1' NODE_BINARY=\"\$NODE_BINARY\" APP_NODE_VERSION='${TARGET_NODE_VERSION}' \"\$PM2_BINARY\" start ecosystem.config.cjs --update-env
  fi
  \"\$PM2_BINARY\" save
  sleep 5
  \"\$PM2_BINARY\" status '${PM2_APP_NAME}'
  echo '=== 健康檢查 ==='
  curl -fsS 'http://127.0.0.1:${APP_PORT}/api/health'
"

echo "=== 部署完成 ==="
