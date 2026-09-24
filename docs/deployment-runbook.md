# Deployment runbook

This is the operational source of truth for application releases. It covers the
intended personal-maintainer path; the external settings listed at the end have
not all been applied or verified. Do not treat this document as evidence that a
release or operational cutover has completed.

## Target setup

- Work from `feature/*` branches opened from `main`, then merge a reviewed PR to
  `main`. A permanent `staging` branch is optional.
- Keep the existing `care-record` Production Vercel project and
  `care-record-staging` Preview project. The target is Production deployments
  from `main` in `care-record`, and feature-branch Preview deployments in
  `care-record-staging`.
- Keep the staging and Production Supabase projects separate. Use the staging
  project for hosted Auth, Storage, or integration checks that local E2E cannot
  cover. Use synthetic or anonymized data there.
- Deploy the application through Vercel Git integration. Do not use a manual
  application deployment workflow for routine releases.
- Keep `full-backup.yml` and `backup-freshness.yml` as separate backup and
  freshness operations. Keep one external `/api/health` monitor after its
  endpoint and notification path are healthy. A backup or health check does
  not replace another one.

Vercel uses its configured Production Branch for Production deployments; other
branches can receive Preview deployments. Set the Production project's branch
to `main`, and configure its Preview build filter so feature branches build in
the staging project only. See [the Vercel Git deployment documentation](https://vercel.com/docs/deployments/git).

## One-time setup and cutover

1. In GitHub, configure the `main` ruleset or branch protection to require the
   fixed CI result documented in [testing.md](testing.md). Permit the single
   maintainer to merge after self-review and successful checks; do not require a
   second human reviewer for routine changes.
2. Read back the Vercel settings. In `care-record`, Production Branch should be
   `main` and its Preview filter should skip feature branches. A skip-Preview
   filter was applied and read back on 2026-09-23. In `care-record-staging`,
   keep the Preview-only filter and verify that feature branches produce
   Preview deployments. Check deployment protection and that Preview cannot
   access Production secrets or data.
3. Configure app variables in each Vercel project's correct environment scope
   using [.env.example](../.env.example) as the variable-name reference. Use
   separate Supabase refs and keys. Do not put server-only values under a
   `NEXT_PUBLIC_` name. Verify the Production scope includes
   `SUPABASE_SERVICE_ROLE_KEY`, which the health endpoint requires.
4. Reuse the existing GitHub Environments for the backup and health workflows
   only. The repository passes lowercase `staging` and `production` values; the
   inspected account has an existing `Production` Environment. Confirm that
   the workflow resolves to that same Environment, and do not create a second
   one with a casing-only name difference. Configure the required values in
   the matching Environment:

   - `BACKUP_DATABASE_URL` (Supavisor session pooler)
   - `DISCORD_ALERT_WEBHOOK_URL`
   - `VERCEL_AUTOMATION_BYPASS_SECRET` only if Deployment Protection requires
     it for the health probe

   Configure these Environment variables:

   - `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `GCP_BACKUP_SERVICE_ACCOUNT`
   - `GCS_BACKUP_BUCKET` and `GCS_REPLICA_BUCKET`
   - `BACKUP_CONFIG_VERSION` and `BACKUP_KEY_ID`
   - `HEALTHCHECK_URL` for the external health workflow

   See the three workflow files for their exact per-job use. Do not create a
   cloud E2E Environment or E2E Supabase secrets; E2E uses local Supabase.
5. Configure the backup module's Workload Identity Federation `github_refs` as
   exact refs. The current Terraform validation accepts complete branch or tag
   refs, not wildcard patterns. The scheduled and manual backup workflow runs
   from `main`; both environment identities may therefore allow
   `refs/heads/main`, while GitHub Environment selection separates staging from
   Production. Keep Production limited to `main`.
6. Review current backup and restore evidence. Repeat a restore rehearsal if the
   backup method changed or the evidence is due under
   [backup-restore-bcp.md](compliance/backup-restore-bcp.md). Check the freshness
   alert path and repair the external health probe and notifications before
   declaring the cutover operational. Keep the full database backup and
   freshness monitor. The legacy `keep_alive.yml` was removed from the
   repository; it was not a health monitor.

## Routine application release

1. Create a feature branch from current `main`, make the change, and open a PR.
2. Review the complete diff yourself. Check the CI conclusion and the relevant
   Preview. If the change needs hosted Auth or integration behavior, use the
   staging Supabase project and record the Preview URL.
3. If there is no database change, merge after the checks pass. Vercel Git
   integration deploys the resulting `main` commit to Production.
4. Check `/api/health`, sign in, and save one minimal test record. Record the
   candidate SHA, CI result, deployment URL, and smoke-check result in the PR.
5. If the release fails, use the application rollback steps below and record
   the affected deployment and result.

Routine releases do not require a new restore drill, legal review, or full
initial-readiness evidence pass. Run those at initial service operation,
material system changes, and their scheduled intervals.

## Database release

Every migration is an explicit manual operation against a named Supabase
project. Review the candidate SHA, migration files, and target project before
each apply. The Supabase CLI version below matches the version pinned in CI.

1. Add a new migration file. Never edit or delete a migration already applied
   to a shared database. Prefer additive changes that work with both the
   current and candidate application versions.
2. Start from the feature branch. Link the CLI to the staging project, then
   inspect the migration history. Confirm `$STAGING_PROJECT_REF` against the
   Staging project ref in the Supabase Dashboard before running these commands:

   ```sh
   npx --yes supabase@2.108.0 link --project-ref "$STAGING_PROJECT_REF"
   npx --yes supabase@2.108.0 migration list --linked
   npx --yes supabase@2.108.0 db push --linked --dry-run
   ```

   Compare the linked migration history and pending migrations with the PR.
   Apply to staging only after the dry-run matches the reviewed migration set:

   ```sh
   npx --yes supabase@2.108.0 db push --linked
   ```

3. Check the Preview against staging when the migration changes hosted Auth,
   Storage, or external integrations. Record the result in the PR.
4. Before Production, confirm `$PRODUCTION_PROJECT_REF` against the Production
   project ref in the Supabase Dashboard. Confirm a recent successful full
   backup and passing freshness check, then link and inspect Production:

   ```sh
   npx --yes supabase@2.108.0 link --project-ref "$PRODUCTION_PROJECT_REF"
   npx --yes supabase@2.108.0 migration list --linked
   npx --yes supabase@2.108.0 db push --linked --dry-run
   ```

   Apply only after the project, history, and dry-run match the reviewed
   migration set:

   ```sh
   npx --yes supabase@2.108.0 db push --linked
   ```

   Record the project ref, migration names, dry-run, backup run, and apply
   result in the PR. Stop if any value differs from the intended target.
5. Merge the PR after the Production schema is compatible with the currently
   running application. Vercel then deploys the new application from `main`.
6. Remove old columns, constraints, or functions only in a later release, once
   all deployed application code has stopped using them.

If Production DB changes cannot safely coexist with the current application,
stop and split the change into expand, migrate, switch, and contract releases.
Do not attempt to reverse a migration by editing its applied file.

## Application rollback and database recovery

For a bad application deployment, open the previous successful Production
deployment in Vercel and roll back or promote that deployment using the Vercel
deployment controls. Check health, sign-in, and a minimal record save afterward.
Record the deployment used and the result in the PR or incident record.

An application rollback does not roll back the database. If a migration caused
data loss or an incompatible schema, stop application changes and follow
[backup-restore-bcp.md](compliance/backup-restore-bcp.md). Database restore is a
separate recovery operation with an explicit target, backup generation, and
evidence record.

## Backup and monitoring operations

- `full-backup.yml` runs on its schedule and can be dispatched for `staging` or
  `production`. Use it manually before a Production migration if the latest
  successful backup is outside the approved freshness window.
- `backup-freshness.yml` checks the full backup and replica freshness hourly.
  Keep its alert path working independently from application deployment.
- `external-health.yml` checks the non-PII `/api/health` endpoint every five
  minutes. Its GitHub Environment must supply `HEALTHCHECK_URL` and
  `DISCORD_ALERT_WEBHOOK_URL`; if deployment protection blocks the probe, also
  configure `VERCEL_AUTOMATION_BYPASS_SECRET` as supported by the workflow.
  Investigate the endpoint and notification path whenever the workflow fails;
  a green GitHub run alone does not prove every production function is healthy.
- Perform a full restore rehearsal before first service operation and then at
  the cadence in [backup-restore-bcp.md](compliance/backup-restore-bcp.md).
  Record generation, target project, measured RPO/RTO, and evidence there.
- The daily business exports in the application serve a separate purpose from
  the full logical database backup. Keep both.

## Read-only status snapshot

External settings were inspected on 2026-09-23 and 2026-09-24. These facts
describe the inspected accounts and do not prove a Production deployment from
this branch:

- GitHub Actions is active. The latest full logical backup and backup freshness
  runs succeeded.
- The external health workflow has a failed historical run under investigation.
  Run `35788093677` failed the HTTP 200 check and failure notification; the HTTP
  status was not logged. Both public health URLs returned HTTP 200 on
  2026-09-23. `HEALTHCHECK_URL` was then set to
  `https://care-record.shoug.org` in the existing `Production` Environment and
  read back. `DISCORD_ALERT_WEBHOOK_URL` is absent from that Environment's
  secret list; the notification path remains unverified.
- PR #17 passed App, empty-database and pgTAP, UI, dependency audit, secret
  scan, local Supabase E2E, and the final `CI` check on 2026-09-24. Its
  `care-record-staging` Preview reached READY and requires Vercel SSO.
- `main` branch protection was configured and read back on 2026-09-24. It
  requires a PR and the `CI` check, allows zero required approvals for the
  single maintainer, applies to admins, and blocks force pushes and deletion.
- The legacy `e2e` GitHub Environment still contains six cloud E2E secrets
  (`E2E_SUPABASE_ANON_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`,
  `E2E_SUPABASE_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and
  `SUPABASE_PROJECT_ID`). Remove that Environment only after the replacement CI
  succeeds on a PR and no workflow references it; deleting it also deletes its
  stored secret values. The replacement CI has now passed, but this deletion
  has not been approved or performed.
- Both Vercel projects exist. Staging builds Previews. A filter to skip Preview
  builds in the Production project was applied and read back on 2026-09-23.
- The Production Vercel variable listing did not show
  `SUPABASE_SERVICE_ROLE_KEY` in Production scope. The deployed health endpoint
  currently returns HTTP 200, so this does not explain the past monitor
  failure. Verify the key's scope before the next deployment.

Configure the missing environment values, verify alert delivery, and complete
the Production release checks before marking the release path operational.

## Specification references checked

Context7 documentation was checked on 2026-09-23 before updating this runbook:

- [Vercel Git deployments](https://vercel.com/docs/deployments/git): configured
  Production Branch behavior and Preview deployments from other branches.
- [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction):
  local status, start/reset/stop, linked migration listing, and `db push
  --dry-run` syntax. Project and CI use Supabase CLI 2.108.0.
- [GitHub Actions job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions):
  skipped conditional jobs and stable final status checks.
