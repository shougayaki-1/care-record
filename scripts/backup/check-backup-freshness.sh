#!/usr/bin/env bash
set -euo pipefail

: "${GCS_BACKUP_BUCKET:?GCS_BACKUP_BUCKET is required}"
: "${GCS_REPLICA_BUCKET:?GCS_REPLICA_BUCKET is required}"
: "${APP_ENV:?APP_ENV is required}"
case "$APP_ENV" in production|staging) ;; *) echo "Invalid APP_ENV" >&2; exit 2 ;; esac
case "${GCS_TIERED_BACKUP_ENABLED:-false}" in true|false) ;; *) echo "Invalid GCS_TIERED_BACKUP_ENABLED" >&2; exit 2 ;; esac
prefix="full/${APP_ENV}"
if [[ "${GCS_TIERED_BACKUP_ENABLED:-false}" == "true" ]]; then
  GCS_BACKUP_BUCKET="${GCS_RECENT_BACKUP_BUCKET:?GCS_RECENT_BACKUP_BUCKET is required}"
  GCS_REPLICA_BUCKET="${GCS_RECENT_REPLICA_BUCKET:?GCS_RECENT_REPLICA_BUCKET is required}"
  prefix="full/${APP_ENV}/recent"
fi

latest_epoch() {
  local bucket="$1"
  local latest listing
  listing="$(gcloud storage ls --long --recursive "gs://${bucket}/${prefix}/**")" || return 1
  # Require both objects, and measure dump start from the immutable generation
  # name. Copying an old archive to Osaka must not reset its freshness clock.
  latest="$(awk '$1 ~ /^[0-9]+$/ { objects[$3]=1 }
    END { for (uri in objects) {
      if (uri ~ /[0-9]{8}T[0-9]{6}Z\.tar\.gz$/ && objects[uri ".sha256"]) {
        sub(/^.*-/, "", uri); sub(/\.tar\.gz$/, "", uri); print uri
      }
    }}' <<< "$listing" | sort | tail -n 1)"
  [[ -n "$latest" ]] || return 1
  date --date="${latest:0:4}-${latest:4:2}-${latest:6:2}T${latest:9:2}:${latest:11:2}:${latest:13:2}Z" +%s
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
