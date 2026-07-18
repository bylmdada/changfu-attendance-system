#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

PM2_APP_NAME="${PM2_APP_NAME:-attendance}"
APP_PORT="${APP_PORT:-3000}"
APP_HOST="${APP_HOST:-0.0.0.0}"
ENV_FILE="${ENV_FILE:-.env.production}"
MIN_NODE_VERSION="${MIN_NODE_VERSION:-20.19.6}"
MAX_NODE_MAJOR="${MAX_NODE_MAJOR:-23}"
EXPECTED_NODE_VERSION="${EXPECTED_NODE_VERSION:-}"

version_ge() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

version_lt() {
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" == "$1" && "$1" != "$2" ]]
}

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "❌ 找不到 nvm，請先在 VPS 安裝 nvm 與 Node.js"
  exit 1
fi

# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"

if [[ -n "$EXPECTED_NODE_VERSION" ]]; then
  echo "=== 使用指定的 Node.js 版本 v${EXPECTED_NODE_VERSION} ==="
  nvm install "$EXPECTED_NODE_VERSION" >/dev/null
  nvm use "$EXPECTED_NODE_VERSION" >/dev/null
  nvm alias default "$EXPECTED_NODE_VERSION" >/dev/null
elif ! command -v node >/dev/null 2>&1; then
  DEFAULT_NODE_VERSION="$(nvm version default || true)"
  if [[ -n "$DEFAULT_NODE_VERSION" && "$DEFAULT_NODE_VERSION" != "N/A" ]]; then
    nvm use default >/dev/null
  fi
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
if ! version_ge "$CURRENT_NODE_VERSION" "$MIN_NODE_VERSION"; then
  echo "❌ 目前 Node.js 版本為 ${CURRENT_NODE_VERSION}，正式環境至少需要 ${MIN_NODE_VERSION}"
  exit 1
fi
if ! version_lt "$CURRENT_NODE_VERSION" "$MAX_NODE_MAJOR"; then
  echo "❌ 目前 Node.js 版本為 ${CURRENT_NODE_VERSION}，但 package.json 支援範圍為 <${MAX_NODE_MAJOR}"
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

mkdir -p prisma uploads backups

if [[ ! -f "$ENV_FILE" && "$ENV_FILE" == ".env.production" && -f ".env" ]]; then
  echo "=== 找到既有 .env，沿用為正式環境設定 ==="
  ENV_FILE=".env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cat > .env.production.example <<EOF
DATABASE_URL="file:./prisma/prod.db"
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

if [[ ! -f "prisma/prod.db" && -f "prisma/dev.db" ]]; then
  cp prisma/dev.db prisma/prod.db
fi

if [[ ! -f "prisma/prod.db" ]]; then
  touch prisma/prod.db
fi

echo "=== VPS 生產環境已就緒 ==="
echo "PM2 App: ${PM2_APP_NAME}"
echo "Port: ${APP_PORT}"
echo "Env file: ${ENV_FILE}"
echo "Node: v${CURRENT_NODE_VERSION}"
echo "Node binary: $(command -v node)"
echo "PM2 binary: $(command -v pm2)"
if [[ -n "$EXPECTED_NODE_VERSION" ]]; then
  echo "Pinned Node: v${EXPECTED_NODE_VERSION}"
fi
echo "如為首次部署，建議執行：sudo env PATH=${CURRENT_NVM_BIN}:\$PATH $(command -v pm2) startup systemd -u ${USER} --hp ${HOME}"
