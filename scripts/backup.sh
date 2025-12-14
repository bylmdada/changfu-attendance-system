#!/bin/bash
# ============================================
# 長福考勤系統 - 自動備份腳本
# 備份目標：Synology NAS + Google Drive
# ============================================

# === 設定區 ===
APP_DIR="/home/deploy/app"
DB_FILE="$APP_DIR/prisma/prod.db"
BACKUP_DIR="/home/deploy/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="attendance_backup_$DATE"
RETENTION_DAYS=30

# NAS 設定（需填入您的 NAS 資訊）
NAS_USER="your_nas_user"
NAS_HOST="192.168.1.100"  # 您的 NAS IP
NAS_PATH="/volume1/backups/attendance"

# Google Drive 設定（使用 rclone）
GDRIVE_REMOTE="gdrive"  # rclone 設定的名稱
GDRIVE_PATH="backups/attendance"

# 日誌
LOG_FILE="$BACKUP_DIR/backup.log"

# === 函數 ===
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# === 開始備份 ===
log "========== 開始備份 =========="

# 1. 建立備份目錄
mkdir -p "$BACKUP_DIR/local"
mkdir -p "$BACKUP_DIR/temp"

# 2. 備份資料庫（使用 SQLite 備份指令確保一致性）
log "備份 SQLite 資料庫..."
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/temp/prod.db'"

# 3. 備份環境設定檔
log "備份環境設定檔..."
cp "$APP_DIR/.env" "$BACKUP_DIR/temp/.env" 2>/dev/null || true

# 4. 打包壓縮
log "壓縮備份檔案..."
cd "$BACKUP_DIR/temp"
tar -czf "$BACKUP_DIR/local/$BACKUP_NAME.tar.gz" ./*

# 5. 清理暫存
rm -rf "$BACKUP_DIR/temp"
mkdir -p "$BACKUP_DIR/temp"

# 6. 上傳到 Synology NAS
log "上傳到 Synology NAS..."
if scp -o ConnectTimeout=30 "$BACKUP_DIR/local/$BACKUP_NAME.tar.gz" \
    "$NAS_USER@$NAS_HOST:$NAS_PATH/" 2>/dev/null; then
    log "✅ NAS 備份成功"
else
    log "❌ NAS 備份失敗（請檢查網路連線）"
fi

# 7. 上傳到 Google Drive
log "上傳到 Google Drive..."
if rclone copy "$BACKUP_DIR/local/$BACKUP_NAME.tar.gz" \
    "$GDRIVE_REMOTE:$GDRIVE_PATH/" 2>/dev/null; then
    log "✅ Google Drive 備份成功"
else
    log "❌ Google Drive 備份失敗（請檢查 rclone 設定）"
fi

# 8. 清理舊備份（本地）
log "清理超過 $RETENTION_DAYS 天的本地備份..."
find "$BACKUP_DIR/local" -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete

# 9. 清理舊備份（Google Drive）
log "清理 Google Drive 舊備份..."
rclone delete "$GDRIVE_REMOTE:$GDRIVE_PATH/" \
    --min-age ${RETENTION_DAYS}d 2>/dev/null || true

log "========== 備份完成 =========="
log "備份檔案：$BACKUP_NAME.tar.gz"
log "本地位置：$BACKUP_DIR/local/"
log ""
