#!/usr/bin/env bash
set -euo pipefail

DATE=$(TZ="Asia/Taipei" date +%Y%m%d_%H%M%S)
DB_PATH="${DB_PATH:-/home/deploy/apps/changfu-attendance/prisma/prod.db}"
BACKUP_DIR="${BACKUP_DIR:-/home/deploy/backups}"
BACKUP_FILE="attendance_${DATE}.db"
LOG_FILE="${LOG_FILE:-/home/deploy/backup.log}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-30}"
CLOUD_RETENTION_DAYS="${CLOUD_RETENTION_DAYS:-30}"
ROLLBACK_KEEP_COUNT="${ROLLBACK_KEEP_COUNT:-3}"
GDRIVE1_REMOTE="${GDRIVE1_REMOTE:-gdrive1:changfu-backups/}"
GDRIVE2_REMOTE="${GDRIVE2_REMOTE:-gdrive2:changfu-backups/}"
RCLONE_ENABLED="${RCLONE_ENABLED:-1}"
RCLONE_REQUIRED="${RCLONE_REQUIRED:-0}"
LOCK_DIR="${LOCK_DIR:-$BACKUP_DIR/.backup.lock}"

RAW_BACKUP="$BACKUP_DIR/$BACKUP_FILE"
GZ_BACKUP="${RAW_BACKUP}.gz"
VERIFY_DB="$BACKUP_DIR/.verify_${BACKUP_FILE}"

log() {
  local timestamp
  timestamp=$(TZ=Asia/Taipei date "+%Y-%m-%d %H:%M:%S %Z")
  mkdir -p "$(dirname "$LOG_FILE")"
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

cleanup() {
  rm -f "$VERIFY_DB"
  if [[ -d "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

fail() {
  log "ERROR: $1"
  exit 1
}

prune_keep_latest() {
  local pattern="$1"
  local keep_count="$2"
  local -a files=()

  while IFS= read -r file; do
    files+=("$file")
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" | sort)

  if (( ${#files[@]} <= keep_count )); then
    log "No pruning needed for pattern $pattern (count=${#files[@]}, keep=$keep_count)"
    return
  fi

  local delete_count=$(( ${#files[@]} - keep_count ))
  local file
  for file in "${files[@]:0:delete_count}"; do
    rm -f "$file"
    log "Pruned rollback backup: $(basename "$file")"
  done
}

copy_to_remote() {
  local remote="$1"

  if [[ "$RCLONE_ENABLED" != "1" ]]; then
    log "rclone disabled; skipped remote copy to $remote"
    return 0
  fi

  if [[ -z "$remote" ]]; then
    return 0
  fi

  if ! command -v rclone >/dev/null 2>&1; then
    if [[ "$RCLONE_REQUIRED" == "1" ]]; then
      fail "rclone not found; set RCLONE_REQUIRED=0 to allow local-only backups"
    fi
    log "rclone not found; skipped remote copy to $remote"
    return 0
  fi

  if rclone copy "$GZ_BACKUP" "$remote" --log-file="$LOG_FILE"; then
    log "Remote backup copied to $remote"
  elif [[ "$RCLONE_REQUIRED" == "1" ]]; then
    fail "remote backup copy failed: $remote"
  else
    log "WARN: Remote backup copy failed but local backup is kept: $remote"
  fi

  if ! rclone delete --min-age "${CLOUD_RETENTION_DAYS}d" "$remote" --log-file="$LOG_FILE"; then
    log "WARN: Remote retention cleanup failed: $remote"
  fi
}

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_PATH" ]]; then
  fail "database not found: $DB_PATH"
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  fail "sqlite3 not found"
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another backup appears to be running: $LOCK_DIR"
fi

trap cleanup EXIT
log "Backup started: $DB_PATH"
sqlite3 "$DB_PATH" ".backup '$RAW_BACKUP'"
gzip -f "$RAW_BACKUP"

gunzip -c "$GZ_BACKUP" > "$VERIFY_DB"
integrity_result="$(sqlite3 "$VERIFY_DB" "PRAGMA integrity_check;")"
if [[ "$integrity_result" != "ok" ]]; then
  fail "backup integrity check failed: $integrity_result"
fi
log "Integrity check passed: $(basename "$GZ_BACKUP")"

copy_to_remote "$GDRIVE1_REMOTE"
copy_to_remote "$GDRIVE2_REMOTE"

find "$BACKUP_DIR" -maxdepth 1 -type f -name "attendance_*.db.gz" -mtime +"$LOCAL_RETENTION_DAYS" -delete

prune_keep_latest "changfu-predeploy_*.tar.gz" "$ROLLBACK_KEEP_COUNT"
prune_keep_latest "prod_pre_deploy_*.db" "$ROLLBACK_KEEP_COUNT"

log "Backup completed: $(basename "$GZ_BACKUP")"
