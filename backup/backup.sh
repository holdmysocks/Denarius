#!/bin/sh
set -e

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

# mktemp makes concurrent/manual backups collision-safe on the shared mount.
# Both intermediate files stay hidden; the completed gzip is atomically renamed.
TEMP_SQL=$(mktemp "/backups/.db-${TIMESTAMP}.sql.XXXXXX")
TEMP_GZIP="${TEMP_SQL}.gz"
UNIQUE_SUFFIX="${TEMP_SQL##*.}"
BACKUP_FILE="/backups/db-${TIMESTAMP}-${UNIQUE_SUFFIX}.sql.gz"

cleanup() {
  rm -f "${TEMP_SQL}" "${TEMP_GZIP}"
}
trap cleanup EXIT HUP INT TERM

echo "[$(date)] Starting backup to ${BACKUP_FILE}"

# Do not pipe pg_dump into gzip: POSIX sh cannot reliably report failure from
# the first pipeline command. Each command must succeed before publication.
pg_dump \
  -h "${POSTGRES_HOST:-postgres}" \
  -U "${POSTGRES_USER:-denarius}" \
  -d "${POSTGRES_DB:-denarius}" \
  --no-password \
  > "${TEMP_SQL}"

gzip -c "${TEMP_SQL}" > "${TEMP_GZIP}"
mv "${TEMP_GZIP}" "${BACKUP_FILE}"
rm -f "${TEMP_SQL}"
trap - EXIT HUP INT TERM

echo "[$(date)] Backup complete: ${BACKUP_FILE} ($(du -sh "${BACKUP_FILE}" | cut -f1))"

# Prune backups older than RETAIN_DAYS
echo "[$(date)] Pruning backups older than ${RETAIN_DAYS} days"
find /backups -name "db-*.sql.gz" -mtime "+${RETAIN_DAYS}" -delete
echo "[$(date)] Pruning complete"
