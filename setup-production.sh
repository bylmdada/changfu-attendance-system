#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

PM2_APP_NAME="${PM2_APP_NAME:-attendance}"
APP_PORT="${APP_PORT:-3000}"
APP_HOST="${APP_HOST:-0.0.0.0}"
ENV_FILE="${ENV_FILE:-.env.production}"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "❌ 找不到 nvm，請先在 VPS 安裝 nvm 與 Node.js"
  exit 1
fi

# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 找不到 node，請先在 VPS 安裝 Node.js"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 找不到 npm，請先在 VPS 安裝 Node.js"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "=== 安裝 PM2 ==="
  npm install -g pm2
fi

mkdir -p prisma uploads backups

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
