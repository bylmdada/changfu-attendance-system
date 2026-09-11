#!/usr/bin/env bash
set -euo pipefail

# Dependencies and build already exist in STAGE_PATH. No live files are touched until backups pass.
: "${DEPLOY_PATH:?}" "${STAGE_PATH:?}" "${REMOTE_ENV_FILE:?}"
PM2_APP_NAME="${PM2_APP_NAME:-attendance}"
APP_PORT="${APP_PORT:-3000}"
APP_HOST="${APP_HOST:-0.0.0.0}"
STAMP="$(date +%Y%m%d_%H%M%S)_$$"
PREVIOUS="${DEPLOY_PATH}.previous-${STAMP}"
FAILED="${DEPLOY_PATH}.failed-${STAMP}"
LOCK="${DEPLOY_PATH}.deploy-lock"
BACKUP_ROOT="${DEPLOY_PATH}.release-backups"
DB_SNAPSHOT="$BACKUP_ROOT/${STAMP}.db"
HAD_APP=0
STOPPED=0
SWITCHED=0
HAD_DB=0
command -v sqlite3 >/dev/null
command -v pm2 >/dev/null
DB_PATH="$(node "$STAGE_PATH/scripts/production-database.cjs" "$STAGE_PATH/$REMOTE_ENV_FILE")"
if [[ -f "$DEPLOY_PATH/$REMOTE_ENV_FILE" ]]; then
  PREVIOUS_DB="$(node "$STAGE_PATH/scripts/production-database.cjs" "$DEPLOY_PATH/$REMOTE_ENV_FILE")"
  [[ "$PREVIOUS_DB" == "$DB_PATH" ]] || { echo 'Database target changed; migrate explicitly before deploying'; exit 1; }
fi
export DATABASE_URL="file:$DB_PATH"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
mkdir "$LOCK" || { echo 'Another deployment is active'; exit 1; }

rollback() {
  local result="$1"
  trap - ERR INT TERM
  set +e
  if [[ "$SWITCHED" == 1 ]]; then
    pm2 stop "$PM2_APP_NAME" >/dev/null 2>&1
    mv "$DEPLOY_PATH" "$FAILED" || { echo 'Cannot preserve failed release; keep service stopped'; exit "$result"; }
    if [[ -d "$PREVIOUS" ]]; then
      mv "$PREVIOUS" "$DEPLOY_PATH" || { echo 'Cannot restore previous release; keep service stopped'; exit "$result"; }
    fi
    if [[ "$HAD_DB" == 1 ]]; then
      mkdir -p "$(dirname "$DB_PATH")"
      rm -f "$DB_PATH-wal" "$DB_PATH-shm"
      sqlite3 "$DB_SNAPSHOT" ".backup '$DB_PATH'" || { echo 'Database restore failed; keep service stopped'; exit "$result"; }
    fi
  fi
  if [[ ! -d "$DEPLOY_PATH" && -d "$PREVIOUS" ]]; then mv "$PREVIOUS" "$DEPLOY_PATH"; fi
  if [[ "$HAD_APP" == 1 && "$STOPPED" == 1 ]]; then
    pm2 restart "$PM2_APP_NAME" --update-env
  fi
  echo "Deployment failed; previous release restored where available. Candidate retained: $FAILED"
  exit "$result"
}
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
trap 'rollback $?' ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM

if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  HAD_APP=1
  pm2 stop "$PM2_APP_NAME"
  STOPPED=1
fi
if [[ -f "$DB_PATH" ]]; then
  HAD_DB=1
  sqlite3 "$DB_PATH" ".backup '$DB_SNAPSHOT'"
  [[ "$(sqlite3 "$DB_SNAPSHOT" 'PRAGMA integrity_check;')" == 'ok' ]] || rollback 1
  chmod 600 "$DB_SNAPSHOT"
fi
for directory in uploads data public/uploads; do
  if [[ -d "$DEPLOY_PATH/$directory" ]]; then
    mkdir -p "$STAGE_PATH/$directory"
    rsync -a "$DEPLOY_PATH/$directory/" "$STAGE_PATH/$directory/"
  fi
done
if [[ -d "$DEPLOY_PATH" ]]; then mv "$DEPLOY_PATH" "$PREVIOUS"; fi
if ! mv "$STAGE_PATH" "$DEPLOY_PATH"; then
  if [[ -d "$PREVIOUS" ]]; then mv "$PREVIOUS" "$DEPLOY_PATH"; fi
  false
fi
SWITCHED=1
cd "$DEPLOY_PATH"
mkdir -p "$(dirname "$DB_PATH")"
if [[ "$HAD_DB" == 1 ]]; then
  # Restore the consistent snapshot when the DB lived inside the renamed release.
  if [[ ! -f "$DB_PATH" ]]; then sqlite3 "$DB_SNAPSHOT" ".backup '$DB_PATH'"; fi
fi
if [[ ! -f "$DB_PATH" ]]; then sqlite3 "$DB_PATH" 'PRAGMA user_version = 0;'; fi
node scripts/ensure-initial-baseline.cjs "$DB_PATH"
node --env-file="$REMOTE_ENV_FILE" node_modules/prisma/build/index.js migrate deploy
node scripts/migrate-dependent-attachments.cjs
export NODE_BINARY="$(command -v node)"
export ENV_FILE="$REMOTE_ENV_FILE" PORT="$APP_PORT" HOSTNAME="$APP_HOST" TZ='Asia/Taipei'
export PM2_APP_NAME NEXT_TELEMETRY_DISABLED=1
pm2 startOrReload ecosystem.config.cjs --update-env
healthy=0
for attempt in {1..15}; do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; then healthy=1; break; fi
  sleep 2
done
[[ "$healthy" == 1 ]] || rollback 1
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/attendance/records")" == 401 ]] || rollback 1
pm2 save
trap - ERR INT TERM
echo "Release healthy. Previous files: $PREVIOUS; database snapshot: $DB_SNAPSHOT"
