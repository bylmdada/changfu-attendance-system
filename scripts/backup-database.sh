#!/bin/bash
set -euo pipefail

DATE=$(TZ="Asia/Taipei" date +%Y%m%d_%H%M%S)
DB_PATH="${DB_PATH:-/home/deploy/apps/changfu-attendance/prisma/prod.db}"
BACKUP_DIR="${BACKUP_DIR:-/home/deploy/backups}"
BACKUP_FILE="attendance_${DATE}.db"
LOG_FILE="${LOG_FILE:-/home/deploy/backup.log}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
CLOUD_RETENTION_DAYS="${CLOUD_RETENTION_DAYS:-30}"
ROLLBACK_KEEP_COUNT="${ROLLBACK_KEEP_COUNT:-3}"
GDRIVE1_REMOTE="${GDRIVE1_REMOTE:-gdrive1:changfu-backups/}"
GDRIVE2_REMOTE="${GDRIVE2_REMOTE:-gdrive2:changfu-backups/}"

log() {
  local timestamp
  timestamp=$(TZ=Asia/Taipei date "+%Y-%m-%d %H:%M:%S %Z")
  echo "[$timestamp] $1" >> "$LOG_FILE"
}

prune_keep_latest() {
  local pattern="$1"
  local keep_count="$2"
  local -a files=()

  mapfile -t files < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" -printf "%f\n" | sort)

  if (( ${#files[@]} <= keep_count )); then
    log "No pruning needed for pattern $pattern (count=${#files[@]}, keep=$keep_count)"
    return
  fi

  local delete_count=$(( ${#files[@]} - keep_count ))
  local file
  for file in "${files[@]:0:delete_count}"; do
    rm -f "$BACKUP_DIR/$file"
    log "Pruned rollback backup: $file"
  done
}

mkdir -p "$BACKUP_DIR"
cp "$DB_PATH" "$BACKUP_DIR/$BACKUP_FILE"
gzip -f "$BACKUP_DIR/$BACKUP_FILE"

rclone copy "$BACKUP_DIR/${BACKUP_FILE}.gz" "$GDRIVE1_REMOTE" --log-file="$LOG_FILE"
rclone copy "$BACKUP_DIR/${BACKUP_FILE}.gz" "$GDRIVE2_REMOTE" --log-file="$LOG_FILE"

find "$BACKUP_DIR" -maxdepth 1 -type f -name "attendance_*.db.gz" -mtime +"$LOCAL_RETENTION_DAYS" -delete
rclone delete --min-age "${CLOUD_RETENTION_DAYS}d" "$GDRIVE1_REMOTE" --log-file="$LOG_FILE"
rclone delete --min-age "${CLOUD_RETENTION_DAYS}d" "$GDRIVE2_REMOTE" --log-file="$LOG_FILE"

prune_keep_latest "changfu-predeploy_*.tar.gz" "$ROLLBACK_KEEP_COUNT"
prune_keep_latest "prod_pre_deploy_*.db" "$ROLLBACK_KEEP_COUNT"

log "Backup completed: ${BACKUP_FILE}.gz"