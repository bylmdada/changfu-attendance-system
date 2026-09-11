#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

PM2_APP_NAME="${PM2_APP_NAME:-attendance}"
APP_PORT="${APP_PORT:-3000}"
APP_HOST="${APP_HOST:-0.0.0.0}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
BACKUP_LOG_FILE="${BACKUP_LOG_FILE:-$HOME/backup.log}"
INSTALL_BACKUP_CRON="${INSTALL_BACKUP_CRON:-0}"
BACKUP_CRON_SCHEDULE="${BACKUP_CRON_SCHEDULE:-0 19 * * *}"
MIN_NODE_VERSION="${MIN_NODE_VERSION:-20.19.6}"
MAX_NODE_MAJOR="${MAX_NODE_MAJOR:-23}"
EXPECTED_NODE_VERSION="${EXPECTED_NODE_VERSION:-}"

version_ge() {
  local IFS=.
  local -a current=(${1%%-*})
  local -a required=(${2%%-*})
  local i current_part required_part

  for i in 0 1 2; do
    current_part="${current[$i]:-0}"
    required_part="${required[$i]:-0}"
    if ((10#$current_part > 10#$required_part)); then
      return 0
    fi
    if ((10#$current_part < 10#$required_part)); then
      return 1
    fi
  done

  return 0
}

version_lt() {
  ! version_ge "$1" "$2"
}

is_node_version() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+){0,2}$ ]]
}

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "❌ 找不到 nvm，請先在 VPS 安裝 nvm 與 Node.js"
  exit 1
fi

# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"

if [[ -n "$EXPECTED_NODE_VERSION" ]]; then
  if ! is_node_version "$EXPECTED_NODE_VERSION"; then
    echo "❌ 指定 Node.js 版本格式無效：${EXPECTED_NODE_VERSION}"
    exit 1
  fi

  echo "=== 使用指定的 Node.js 版本 v${EXPECTED_NODE_VERSION} ==="
  nvm install "$EXPECTED_NODE_VERSION" >/dev/null
  nvm use "$EXPECTED_NODE_VERSION" >/dev/null
  nvm alias default "$EXPECTED_NODE_VERSION" >/dev/null
else
  echo "=== 使用 VPS 目前的 Node.js 環境 ==="
  nvm use --silent default >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 找不到 node，請先在 VPS 安裝 Node.js"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 找不到 npm，請先在 VPS 安裝 Node.js"
  exit 1
fi

CURRENT_NODE_VERSION="$(node -v | sed 's/^v//')"
if ! is_node_version "$CURRENT_NODE_VERSION"; then
  echo "❌ Node.js 版本格式無效：${CURRENT_NODE_VERSION}"
  exit 1
fi

if ! version_ge "$CURRENT_NODE_VERSION" "$MIN_NODE_VERSION"; then
  echo "❌ 目前 Node.js 版本為 ${CURRENT_NODE_VERSION}，正式環境至少需要 ${MIN_NODE_VERSION}"
  exit 1
fi
if ! version_lt "$CURRENT_NODE_VERSION" "$MAX_NODE_MAJOR"; then
  echo "❌ 目前 Node.js 版本為 ${CURRENT_NODE_VERSION}，但正式部署支援範圍為 <${MAX_NODE_MAJOR}"
  exit 1
fi
if [[ -n "$EXPECTED_NODE_VERSION" && "$CURRENT_NODE_VERSION" != "$EXPECTED_NODE_VERSION" ]]; then
  echo "❌ 目前 Node.js 版本為 ${CURRENT_NODE_VERSION}，但指定版本為 ${EXPECTED_NODE_VERSION}"
  exit 1
fi

CURRENT_NVM_BIN="${NVM_BIN:-$(dirname "$(command -v node)")}"
CURRENT_PM2_BIN="$(command -v pm2 || true)"
if [[ -z "$CURRENT_PM2_BIN" || "$CURRENT_PM2_BIN" != "$CURRENT_NVM_BIN/"* ]]; then
  echo "=== 在目前 Node 環境安裝/更新 PM2 ==="
  npm install -g pm2
  hash -r
fi

mkdir -p prisma uploads backups "$BACKUP_DIR"

if [[ -f "scripts/backup-database.sh" ]]; then
  chmod +x scripts/backup-database.sh scripts/backup-db.sh 2>/dev/null || true
fi

if [[ ! -f "$ENV_FILE" && "$ENV_FILE" == ".env.production" && -f ".env" ]]; then
  echo "=== 找到既有 .env，沿用為正式環境設定 ==="
  ENV_FILE=".env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cat > .env.production.example <<EOF
DATABASE_URL="file:${PROJECT_ROOT}/prisma/prod.db"
JWT_SECRET="請填入至少 32 字元"
NEXTAUTH_SECRET="請填入至少 32 字元"
NEXTAUTH_URL="https://your-domain.example"
NODE_ENV="production"
PORT="${APP_PORT}"
HOSTNAME="${APP_HOST}"
TZ="Asia/Taipei"
NEXT_TELEMETRY_DISABLED="1"
EOF
  echo "❌ 缺少 ${ENV_FILE}，已建立 .env.production.example 範本，請先補齊後再部署"
  exit 1
fi

DB_PATH="$(node scripts/production-database.cjs "$ENV_FILE")"
export DATABASE_URL="file:$DB_PATH"
mkdir -p "$(dirname "$DB_PATH")"

echo "=== VPS 生產環境已就緒 ==="
echo "PM2 App: ${PM2_APP_NAME}"
echo "Port: ${APP_PORT}"
echo "Env file: ${ENV_FILE}"
echo "Node: v${CURRENT_NODE_VERSION}"
echo "Node binary: $(command -v node)"
echo "PM2 binary: $(command -v pm2)"
echo "Backup dir: ${BACKUP_DIR}"
if [[ -n "$EXPECTED_NODE_VERSION" ]]; then
  echo "Pinned Node: v${EXPECTED_NODE_VERSION}"
fi

if [[ "$INSTALL_BACKUP_CRON" == "1" ]]; then
  if [[ ! -f "scripts/backup-database.sh" ]]; then
    echo "❌ 找不到 scripts/backup-database.sh，無法安裝備份 crontab"
    exit 1
  fi

  BACKUP_COMMAND="DB_PATH=${DB_PATH} BACKUP_DIR=${BACKUP_DIR} LOG_FILE=${BACKUP_LOG_FILE} ${PROJECT_ROOT}/scripts/backup-database.sh"
  CRON_LINE="${BACKUP_CRON_SCHEDULE} ${BACKUP_COMMAND}"
  (crontab -l 2>/dev/null | grep -v "${PROJECT_ROOT}/scripts/backup-database.sh" || true; echo "$CRON_LINE") | crontab -
  echo "Backup cron: ${CRON_LINE}"
fi
if command -v nginx >/dev/null 2>&1; then
  if ! grep -R "client_max_body_size" /etc/nginx/nginx.conf /etc/nginx/sites-enabled /etc/nginx/sites-available >/dev/null 2>&1; then
    echo "⚠️ 偵測到 Nginx 未設定 client_max_body_size；若需上傳 10MB 財產評量附件，請以 sudo 在站台設定加入：client_max_body_size 12m;"
  fi
fi
echo "如為首次部署，建議執行：sudo env PATH=${CURRENT_NVM_BIN}:\$PATH $(command -v pm2) startup systemd -u ${USER} --hp ${HOME}"
