#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL (Supavisor session pooler URL) is required}"
: "${GCS_BACKUP_BUCKET:?GCS_BACKUP_BUCKET is required}"
: "${APP_ENV:?APP_ENV is required}"
: "${BACKUP_CONFIG_VERSION:?BACKUP_CONFIG_VERSION is required}"
: "${BACKUP_KEY_ID:?BACKUP_KEY_ID is required (identifier only; never a key value)}"

case "$APP_ENV" in production|staging) ;; *) echo "APP_ENV must be production or staging" >&2; exit 2 ;; esac
case "$GCS_BACKUP_BUCKET" in *'replace-'*|*'example'*|'') echo "GCS_BACKUP_BUCKET contains a placeholder" >&2; exit 2 ;; esac
case "$DATABASE_URL" in postgresql://*|postgres://*) ;; *) echo "DATABASE_URL must be a PostgreSQL URL" >&2; exit 2 ;; esac

for command in pg_dump pg_dumpall psql gzip jq sha256sum tar gcloud; do
  command -v "$command" >/dev/null || { echo "required command is missing: $command" >&2; exit 2; }
done

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
generation="$(date -u +%Y%m%dT%H%M%SZ)"
year="${generation:0:4}"
month="${generation:4:2}"
day="${generation:6:2}"
work_root="$(mktemp -d)"
trap 'rm -rf "$work_root"' EXIT
backup_dir="$work_root/care-record-${APP_ENV}-${generation}"
mkdir -p "$backup_dir"

# Role password hashes are deliberately excluded. A total Auth loss is recovered
# through the documented password-reset flow, not by exporting credential hashes.
pg_dumpall --dbname="$DATABASE_URL" --globals-only --no-role-passwords \
  | gzip -9 > "$backup_dir/globals.sql.gz"

# A plain logical dump keeps schemas, RLS, functions, triggers, application data,
# Auth, and Storage metadata together and is portable to a clean isolated target.
pg_dump --dbname="$DATABASE_URL" --format=plain --clean --if-exists \
  --no-owner --no-acl --quote-all-identifiers \
  | gzip -9 > "$backup_dir/database.sql.gz"

psql "$DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --csv --command \
  'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version' \
  > "$backup_dir/migrations.csv"

psql "$DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --csv --command \
  'SELECT id, bucket_id, name, created_at, updated_at, metadata FROM storage.objects ORDER BY bucket_id, name' \
  > "$backup_dir/storage-inventory.csv"

database_server_version="$(psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align --command 'SHOW server_version')"
storage_object_count="$(psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align --command 'SELECT count(*) FROM storage.objects')"
jq -n \
  --arg schema_version "1" \
  --arg environment "$APP_ENV" \
  --arg created_at "$started_at" \
  --arg config_version "$BACKUP_CONFIG_VERSION" \
  --arg encryption_key_id "$BACKUP_KEY_ID" \
  --arg database_server_version "$database_server_version" \
  --argjson storage_object_count "$storage_object_count" \
  --arg commit_sha "${GITHUB_SHA:-local}" \
  '{schema_version: $schema_version, environment: $environment, created_at: $created_at,
    config_version: $config_version, encryption_key_id: $encryption_key_id,
    database_server_version: $database_server_version, storage_object_count: $storage_object_count,
    commit_sha: $commit_sha,
    outbound_integrations_forced_disabled_on_restore: true}' \
  > "$backup_dir/backup-metadata.json"

(cd "$backup_dir" && find . -type f ! -name manifest.sha256 -print0 \
  | sort -z | xargs -0 sha256sum > manifest.sha256)
"$(dirname "$0")/verify-backup-manifest.sh" "$backup_dir" >/dev/null

archive="$work_root/$(basename "$backup_dir").tar.gz"
tar --create --gzip --file "$archive" --directory "$work_root" "$(basename "$backup_dir")"
sha256sum "$archive" > "$archive.sha256"

object_prefix="full/${APP_ENV}/${year}/${month}/${day}"
object_uri="gs://${GCS_BACKUP_BUCKET}/${object_prefix}/$(basename "$archive")"
gcloud storage cp --quiet "$archive" "$object_uri"
gcloud storage cp --quiet "$archive.sha256" "${object_uri}.sha256"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "backup_uri=$object_uri"
    echo "backup_generation=$generation"
    echo "backup_sha256=$(sha256sum "$archive" | cut -d' ' -f1)"
  } >> "$GITHUB_OUTPUT"
fi

echo "Backup uploaded: $object_uri"
