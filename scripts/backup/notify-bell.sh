#!/usr/bin/env bash
# Existing backend DB connection; fixed SQL and numeric run ID only.
# Never replace the original backup job failure with a notification failure.
set -u
if [[ -z "${DATABASE_URL:-}" || ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]{1,20}$ ]]; then
  echo 'notification_creation_failed: backup.failed' >&2
  exit 0
fi
if ! psql "$DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=backup_run_id="$GITHUB_RUN_ID" >/dev/null 2>/dev/null <<'SQL'
SELECT private.notify_full_backup_failure(:'backup_run_id');
SQL
then
  echo 'notification_creation_failed: backup.failed' >&2
fi
exit 0
