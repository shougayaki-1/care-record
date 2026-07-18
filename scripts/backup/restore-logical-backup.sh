#!/usr/bin/env bash
set -euo pipefail
umask 077

archive="${1:?usage: restore-logical-backup.sh ARCHIVE_OR_GS_URI}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${RESTORE_ENVIRONMENT:?RESTORE_ENVIRONMENT is required}"
: "${RESTORE_CONFIRM:?RESTORE_CONFIRM=restore-to-isolated-environment is required}"

[[ "$RESTORE_CONFIRM" == "restore-to-isolated-environment" ]] || { echo "restore confirmation does not match" >&2; exit 2; }
case "$RESTORE_ENVIRONMENT" in restore|staging) ;; *) echo "RESTORE_ENVIRONMENT must be restore or staging" >&2; exit 2 ;; esac
[[ "${EMAIL_DELIVERY_ENABLED:-}" == "false" ]] || { echo "EMAIL_DELIVERY_ENABLED=false is required" >&2; exit 2; }
[[ "${GOOGLE_SYNC_ENABLED:-}" == "false" ]] || { echo "GOOGLE_SYNC_ENABLED=false is required" >&2; exit 2; }
[[ "${AI_IMPORT_ENABLED:-}" == "false" ]] || { echo "AI_IMPORT_ENABLED=false is required" >&2; exit 2; }
case "$RESTORE_DATABASE_URL" in *prod*|*production*) echo "refusing a production-like restore URL" >&2; exit 2 ;; esac

for command in psql gzip jq sha256sum tar; do
  command -v "$command" >/dev/null || { echo "required command is missing: $command" >&2; exit 2; }
done

started_epoch="$(date +%s)"
work_root="$(mktemp -d)"
trap 'rm -rf "$work_root"' EXIT

if [[ "$archive" == gs://* ]]; then
  command -v gcloud >/dev/null || { echo "gcloud is required for gs:// input" >&2; exit 2; }
  local_archive="$work_root/$(basename "$archive")"
  gcloud storage cp --quiet "$archive" "$local_archive"
else
  local_archive="$archive"
fi

test -f "$local_archive" || { echo "backup archive does not exist" >&2; exit 1; }
tar --list --gzip --file "$local_archive" | awk '
  /^\// || /(^|\/)\.\.($|\/)/ || /\\/ { print "unsafe archive path: " $0 > "/dev/stderr"; bad=1 }
  END { exit bad }
'
tar --list --verbose --gzip --file "$local_archive" | awk '
  substr($1, 1, 1) ~ /[lh]/ { print "archive links are not allowed: " $0 > "/dev/stderr"; bad=1 }
  END { exit bad }
'
tar --extract --gzip --file "$local_archive" --directory "$work_root"
backup_dir="$(find "$work_root" -mindepth 1 -maxdepth 1 -type d -name 'care-record-*' -print -quit)"
test -n "$backup_dir" || { echo "archive root is invalid" >&2; exit 1; }
"$(dirname "$0")/verify-backup-manifest.sh" "$backup_dir"

# The target must be isolated and disposable. The dump's clean statements replace
# its contents; outbound integrations remain disabled by the mandatory guards above.
if [[ "${RESTORE_GLOBALS:-false}" == "true" ]]; then
  gzip --decompress --stdout "$backup_dir/globals.sql.gz" \
    | psql "$RESTORE_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1
fi
gzip --decompress --stdout "$backup_dir/database.sql.gz" \
  | psql "$RESTORE_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --single-transaction

psql "$RESTORE_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
SELECT format('ALTER DATABASE %I SET "care_record.email_delivery_enabled" = ''false''', current_database()) \gexec
SELECT format('ALTER DATABASE %I SET "care_record.google_sync_enabled" = ''false''', current_database()) \gexec
SELECT format('ALTER DATABASE %I SET "care_record.ai_import_enabled" = ''false''', current_database()) \gexec
SQL

verification_json="$(psql "$RESTORE_DATABASE_URL" --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 <<'SQL'
WITH checks AS (
  SELECT 'auth_users' AS name, count(*)::bigint AS value FROM auth.users
  UNION ALL SELECT 'storage_objects', count(*) FROM storage.objects
  UNION ALL SELECT 'reports', count(*) FROM public.reports
  UNION ALL SELECT 'orphan_report_images', count(*) FROM public.report_images ri LEFT JOIN public.reports r ON r.id = ri.report_id WHERE r.id IS NULL
  UNION ALL SELECT 'clients_without_organization', count(*) FROM public.clients WHERE organization_id IS NULL
  UNION ALL SELECT 'audit_chain_missing_parents', count(*) FROM public.audit_events child
    WHERE child.previous_hash IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.audit_events parent
      WHERE parent.organization_id IS NOT DISTINCT FROM child.organization_id
        AND parent.event_hash = child.previous_hash
    )
)
SELECT jsonb_object_agg(name, value)::text FROM checks;
SQL
)"

orphan_images="$(jq -r '.orphan_report_images' <<<"$verification_json")"
org_mismatches="$(jq -r '.clients_without_organization' <<<"$verification_json")"
audit_mismatches="$(jq -r '.audit_chain_missing_parents' <<<"$verification_json")"
expected_storage_objects="$(jq -r '.storage_object_count' "$backup_dir/backup-metadata.json")"
actual_storage_objects="$(jq -r '.storage_objects' <<<"$verification_json")"
psql "$RESTORE_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --csv --command \
  'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version' \
  > "$work_root/restored-migrations.csv"
migrations_match="false"
cmp --silent "$backup_dir/migrations.csv" "$work_root/restored-migrations.csv" && migrations_match="true"
result="pass"
[[ "$orphan_images" == "0" && "$org_mismatches" == "0" && "$audit_mismatches" == "0" \
  && "$expected_storage_objects" == "$actual_storage_objects" && "$migrations_match" == "true" ]] || result="fail"

finished_epoch="$(date +%s)"
rto_minutes="$(( (finished_epoch - started_epoch + 59) / 60 ))"
created_at="$(jq -r '.created_at' "$backup_dir/backup-metadata.json")"
backup_epoch="$(date --date="$created_at" +%s)"
rpo_minutes="$(( (finished_epoch - backup_epoch + 59) / 60 ))"
evidence="$work_root/restore-evidence.json"
jq -n --arg environment "$RESTORE_ENVIRONMENT" --arg backup_reference "$archive" \
  --arg performed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg backup_created_at "$created_at" \
  --arg result "$result" --arg migrations_match "$migrations_match" \
  --argjson achieved_rto_minutes "$rto_minutes" --argjson achieved_rpo_minutes "$rpo_minutes" \
  --argjson expected_storage_objects "$expected_storage_objects" \
  --argjson checks "$verification_json" \
  '{environment: $environment, backup_reference: $backup_reference, performed_at: $performed_at,
    backup_created_at: $backup_created_at, achieved_rpo_minutes: $achieved_rpo_minutes,
    achieved_rto_minutes: $achieved_rto_minutes, expected_storage_objects: $expected_storage_objects,
    migrations_match: ($migrations_match == "true"), integrity_verified: ($result == "pass"),
    result: $result, checks: $checks}' > "$evidence"

if [[ "${RECORD_RESTORE_TEST:-false}" == "true" ]]; then
  psql "$RESTORE_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
    --set=environment="$RESTORE_ENVIRONMENT" --set=reference="$archive" \
    --set=rpo="$rpo_minutes" --set=rto="$rto_minutes" --set=result="$result" <<'SQL'
INSERT INTO public.backup_restore_tests (
  performed_at, environment, backup_reference, expected_rpo_minutes,
  achieved_rpo_minutes, expected_rto_minutes, achieved_rto_minutes,
  integrity_verified, result, notes
) VALUES (
  now(), :'environment', :'reference', 840, :'rpo'::integer, 240, :'rto'::integer,
  :'result' = 'pass', :'result', 'Automated isolated restore and relationship/hash verification'
);
SQL
fi

evidence_destination="${RESTORE_EVIDENCE_PATH:-restore-evidence.json}"
cp "$evidence" "$evidence_destination"
echo "Restore verification result: $result; evidence: $evidence_destination"
[[ "$result" == "pass" ]]
