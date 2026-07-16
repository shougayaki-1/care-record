# CareRecord deployment runbook

This runbook stops at every environment-changing boundary. Run Staging first;
Production is permitted only after the release-readiness checklist has evidence.

## GitHub Environments

Create `e2e`, `staging`, and `production`. Restrict `production` to the protected
`main` branch and enable required reviewers where the repository plan supports it.

For `staging` and `production`, configure these GitHub Environment values.

Secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `VERCEL_TOKEN`
- `BACKUP_DATABASE_URL` (Supavisor session pooler)
- `DISCORD_ALERT_WEBHOOK_URL`

Variables:

- `SUPABASE_PROJECT_ID`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_BACKUP_SERVICE_ACCOUNT`
- `GCS_BACKUP_BUCKET`
- `GCS_REPLICA_BUCKET`
- `BACKUP_CONFIG_VERSION`
- `BACKUP_KEY_ID`

The `e2e` environment uses `E2E_SUPABASE_URL`,
`E2E_SUPABASE_ANON_KEY`, and `E2E_SUPABASE_SERVICE_ROLE_KEY`. It must never use
Production credentials or Production personal data.

## Vercel environment

Configure all staging/production values from `.env.example` in the corresponding
Vercel environment. Set `APP_ENV` and both expected project IDs explicitly. Keep
`AI_IMPORT_ENABLED=false` for the initial Production rollout. Never give
server-only secrets a `NEXT_PUBLIC_` prefix.

Before deployment, verify that the Supabase URL project ref equals
`EXPECTED_SUPABASE_PROJECT_ID`, the GCP project equals `EXPECTED_GCP_PROJECT_ID`,
and every bucket name contains the correct environment marker.

## Staging sequence

1. Run CI and the dedicated E2E workflow.
2. Dispatch `Deploy database and application` with `environment=staging` and the
   release branch ref.
3. Confirm the migration dry-run, final migration artifact, deployment URL, and
   `/api/health` artifact.
4. Dispatch `Full logical backup` for Staging.
5. Dispatch `Backup freshness` for Staging and verify the Discord failure path.
6. Restore that generation into a disposable isolated project with email,
   Google sync, and AI forced off. Attach `restore-evidence.json`.

## Production sequence

1. Record the approved commit SHA and all checklist evidence.
2. Merge the approved PR to protected `main`.
3. Take a pre-deployment backup if Production already contains data.
4. Dispatch `Deploy database and application` with
   `environment=production`, `git_ref=main`.
5. Approve the protected GitHub Environment only after reviewing the migration
   target Project ID and dry-run evidence.
6. Verify health, authentication, tenant denial, a minimal record save, audit
   write, Discord alerting, and a manual full backup.
7. Enable only the approved pilot organizations.

## Stop conditions

Stop on a migration mismatch, wrong Project ID, failed tenant-denial test,
failed restore, RPO over 14 hours, RTO over 4 hours, backup age over 14 hours,
image replica age over 26 hours, failed alert delivery, or any unresolved
Critical/unaccepted High item.

Bucket Lock is not part of the deployment workflow. Keep
`enable_bucket_lock=false`, save and review the Terraform plan, and obtain a
separate approval before the irreversible apply.
