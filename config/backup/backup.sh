#!/bin/sh
# MoneyPulse DB Backup Script
# Runs via cron inside the backup container (daily 2 AM)

set -e

DATE=$(date +%Y-%m-%d_%H%M)
BACKUP_DIR="/backup"
FILENAME="moneypulse_${DATE}.sql.gz"

echo "[$(date)] Starting backup..."

pg_dump --format=custom | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "[$(date)] Backup complete: ${FILENAME}"

# Retain 30 days, delete older
find "${BACKUP_DIR}" -name "moneypulse_*.sql.gz" -mtime +30 -delete

echo "[$(date)] Cleanup complete. Remaining backups:"
ls -lh "${BACKUP_DIR}"/moneypulse_*.sql.gz 2>/dev/null || echo "  (none)"
