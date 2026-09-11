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
    nvm use --silent default >/dev/null 2>&1 || true
    node -v
  '
)"

if [[ "$REMOTE_NODE_VERSION" == "missing-nvm" ]]; then
  echo "❌ VPS 尚未安裝 nvm，請先在 VPS 完成 nvm / Node 安裝"
  exit 1
fi

REMOTE_NODE_VERSION="${REMOTE_NODE_VERSION#v}"
TARGET_NODE_VERSION="${EXPECTED_NODE_VERSION:-$REMOTE_NODE_VERSION}"

if ! is_node_version "$TARGET_NODE_VERSION"; then
  echo "❌ Node 版本格式無效：${TARGET_NODE_VERSION}"
  exit 1
fi

if [[ -n "$EXPECTED_NODE_VERSION" && "$REMOTE_NODE_VERSION" != "$EXPECTED_NODE_VERSION" ]]; then
  echo "=== VPS 目前 Node 版本為 ${REMOTE_NODE_VERSION}，將切換為指定的 ${EXPECTED_NODE_VERSION} ==="
else
  echo "=== 以 VPS 目前 Node 版本 ${REMOTE_NODE_VERSION} 作為本次部署基準 ==="
fi

if ! version_ge "$TARGET_NODE_VERSION" "$MIN_NODE_VERSION"; then
  echo "❌ 目標 Node 版本為 ${TARGET_NODE_VERSION}，正式環境至少需要 ${MIN_NODE_VERSION}"
  exit 1
fi
if ! version_lt "$TARGET_NODE_VERSION" "$MAX_NODE_MAJOR"; then
  echo "❌ 目標 Node 版本為 ${TARGET_NODE_VERSION}，但正式部署支援範圍為 <${MAX_NODE_MAJOR}"
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
  DATABASE_URL=file:/tmp/changfu-build.sqlite JWT_SECRET=build-test-only npm run verify
elif [[ "$(node -v 2>/dev/null || true)" == "v${TARGET_NODE_VERSION}" ]]; then
  echo "=== 本機已是相同 Node 版本，直接建置 ==="
  npm ci
  DATABASE_URL=file:/tmp/changfu-build.sqlite JWT_SECRET=build-test-only npm run verify
else
  echo "=== 本機沒有 nvm，改用暫時的 Node ${TARGET_NODE_VERSION} 建置 ==="
  npx -y -p "node@${TARGET_NODE_VERSION}" -p "npm@10" -c 'npm ci && DATABASE_URL=file:/tmp/changfu-build.sqlite JWT_SECRET=build-test-only npm run verify'
fi

# Restrict values interpolated into the remote shell to literal operational identifiers.
for value in "$DEPLOY_PATH" "$REMOTE_ENV_FILE" "$PM2_APP_NAME" "$APP_HOST"; do
  [[ "$value" =~ ^[A-Za-z0-9_./-]+$ ]] || { echo 'Unsafe remote path or identifier'; exit 1; }
done
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || exit 1
STAGE_PATH="${DEPLOY_PATH}.incoming-$(date +%Y%m%d_%H%M%S)-$$"
echo "=== 同步至暫存版本 ==="
ssh_remote "mkdir -p '$STAGE_PATH'"
rsync -az --rsh="$RSYNC_RSH" \
  --exclude '.git/' --exclude '.github/' --exclude '.claude/' --exclude '.recall/' \
  --exclude 'node_modules/' --exclude 'uploads/' --exclude 'data/' --exclude 'backups/' \
  --exclude 'certs/' --exclude '.env*' --exclude '*.db*' --exclude '*.tsbuildinfo' \
  ./ "${VPS_USER}@${VPS_HOST}:${STAGE_PATH}/"
if [[ -f "$LOCAL_ENV_FILE" ]]; then
  rsync -az --rsh="$RSYNC_RSH" "$LOCAL_ENV_FILE" "${VPS_USER}@${VPS_HOST}:${STAGE_PATH}/${REMOTE_ENV_FILE}"
else
  ssh_remote "cp '$DEPLOY_PATH/$REMOTE_ENV_FILE' '$STAGE_PATH/$REMOTE_ENV_FILE'"
fi

echo "=== 暫存版本安裝依賴；完成後備份與切換 ==="
ssh_remote "
  set -euo pipefail
  export NVM_DIR=\"\$HOME/.nvm\"
  . \"\$NVM_DIR/nvm.sh\"
  nvm install '${TARGET_NODE_VERSION}' >/dev/null
  nvm use '${TARGET_NODE_VERSION}' >/dev/null
  cd '$STAGE_PATH'
  chmod 600 '$REMOTE_ENV_FILE'
  node scripts/production-database.cjs '$REMOTE_ENV_FILE' >/dev/null
  npm ci --omit=dev
  node node_modules/prisma/build/index.js generate
  DEPLOY_PATH='$DEPLOY_PATH' STAGE_PATH='$STAGE_PATH' REMOTE_ENV_FILE='$REMOTE_ENV_FILE' PM2_APP_NAME='$PM2_APP_NAME' APP_PORT='$APP_PORT' APP_HOST='$APP_HOST' bash scripts/activate-release.sh
"
echo "=== 部署完成 ==="
