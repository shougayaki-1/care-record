#!/usr/bin/env bash
set -euo pipefail

: "${GCS_BACKUP_BUCKET:?GCS_BACKUP_BUCKET is required}"
: "${GCS_REPLICA_BUCKET:?GCS_REPLICA_BUCKET is required}"
: "${APP_ENV:?APP_ENV is required}"

latest_epoch() {
  local bucket="$1"
  local latest
  latest="$(gcloud storage ls --long --recursive "gs://${bucket}/full/${APP_ENV}/**" 2>/dev/null \
    | awk '$1 ~ /^[0-9]+$/ && $3 ~ /\.tar\.gz$/ { print $2 }' | sort | tail -n 1)"
  [[ -n "$latest" ]] || return 1
  date --date="$latest" +%s
}

now="$(date +%s)"
primary="$(latest_epoch "$GCS_BACKUP_BUCKET" || true)"
replica="$(latest_epoch "$GCS_REPLICA_BUCKET" || true)"
status=0

if [[ -z "$primary" || $((now - primary)) -gt 50400 ]]; then
  "$(dirname "$0")/notify-discord.sh" Critical backup_freshness_over_14h "${EVIDENCE_URL:-unavailable}" || true
  status=1
fi

if [[ -z "$replica" || $((now - replica)) -gt 93600 ]]; then
  "$(dirname "$0")/notify-discord.sh" Critical replica_freshness_over_26h "${EVIDENCE_URL:-unavailable}" || true
  status=1
fi

exit "$status"
