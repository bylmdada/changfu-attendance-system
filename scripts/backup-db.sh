#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -ge 1 ]]; then
  export DB_PATH="$1"
fi

if [[ $# -ge 2 ]]; then
  export BACKUP_DIR="$2"
fi

exec "$SCRIPT_DIR/backup-database.sh"
