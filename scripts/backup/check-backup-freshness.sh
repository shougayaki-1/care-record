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

latest_generation() {
  local bucket="$1"
  local latest listing listing_error timestamp epoch
  if ! listing="$(gcloud storage ls --long --recursive "gs://${bucket}/${prefix}/**" 2>&1)"; then
    listing_error="$(tr '[:upper:]' '[:lower:]' <<< "$listing")"
    if [[ "$listing_error" == *403* || "$listing_error" == *permission* || "$listing_error" == *denied* || "$listing_error" == *forbidden* || "$listing_error" == *storage.objects.list* ]]; then
      printf 'listing_permission_denied\tnone\tunknown\n'
    else
      printf 'listing_failed\tnone\tunknown\n'
    fi
    return 0
  fi

  # Require both objects, and measure dump start from the immutable generation
  # name. Copying an old archive to Osaka must not reset its freshness clock.
  latest="$(awk '$1 ~ /^[0-9]+$/ { objects[$3]=1 }
    END { for (uri in objects) {
      if (uri ~ /[0-9]{8}T[0-9]{6}Z\.tar\.gz$/ && objects[uri ".sha256"]) {
        sub(/^.*-/, "", uri); sub(/\.tar\.gz$/, "", uri); print uri
      }
    }}' <<< "$listing" | sort | tail -n 1)"
  if [[ -z "$latest" ]]; then
    printf 'no_valid_pair\tnone\tunknown\n'
    return 0
  fi

  timestamp="${latest:0:4}-${latest:4:2}-${latest:6:2}T${latest:9:2}:${latest:11:2}:${latest:13:2}Z"
  if ! epoch="$(date --date="$timestamp" +%s 2>/dev/null)"; then
    printf 'invalid_generation_timestamp\t%s\tunknown\n' "$timestamp"
    return 0
  fi
  printf 'ok\t%s\t%s\n' "$timestamp" "$epoch"
}

check_target() {
  local target="$1" bucket="$2" threshold="$3" alert_name="$4"
  local result cause latest_utc latest_epoch age now detail
  result="$(latest_generation "$bucket")"
  IFS=$'\t' read -r cause latest_utc latest_epoch <<< "$result"

  if [[ "$cause" == "ok" ]]; then
    now="$(date +%s)"
    age=$((now - latest_epoch))
    if (( age < 0 )); then
      cause="generation_in_future"
    elif (( age > threshold )); then
      cause="age_over_threshold"
    else
      cause="within_threshold"
    fi
  else
    age="unknown"
  fi

  printf 'backup_freshness environment=%s target=%s cause=%s latest_generation_utc=%s age_seconds=%s threshold_seconds=%s\n' \
    "$APP_ENV" "$target" "$cause" "$latest_utc" "$age" "$threshold"

  if [[ "$cause" != "within_threshold" ]]; then
    detail="cause=${cause} latest_generation_utc=${latest_utc} age_seconds=${age} threshold_seconds=${threshold}"
    "$(dirname "$0")/notify-discord.sh" Critical "${alert_name}_${cause}" "${EVIDENCE_URL:-unavailable}" "$detail" || true
    return 1
  fi
  return 0
}

status=0

check_target tokyo "$GCS_BACKUP_BUCKET" 50400 backup_freshness_over_14h || status=1
check_target osaka "$GCS_REPLICA_BUCKET" 93600 replica_freshness_over_26h || status=1

exit "$status"
