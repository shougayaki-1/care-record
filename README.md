# CareRecord

CareRecord is a care-record, shift, and reporting application for home-care
providers. The compliance and operational evidence index is in
[docs/compliance/README.md](docs/compliance/README.md).

## Development

Use Node.js 24 and Docker. Install dependencies, start the local Supabase stack,
and apply the checked-in migrations:

```sh
npm ci
npx --yes supabase@2.108.0 start
npx --yes supabase@2.108.0 db reset
```

Copy `.env.example` to `.env.local`. Set `APP_ENV=local`, turn off external
integrations for ordinary local work, and use the local API URL, anon key, and
service-role key shown by `npx --yes supabase@2.108.0 status --output env`.
Keep `.env.local` untracked. Do not use a hosted project's credentials for local
development or E2E tests.

```sh
npm run dev
```

See [development setup](docs/development.md) and
[test instructions](docs/testing.md) for the full workflow.

## Release flow

The routine path is `feature/*` → pull request → `main`. A permanent `staging`
branch is not required. One maintainer opens the PR, reviews the diff and check
results, and records a short release note in the PR. The release record includes
the candidate SHA, relevant CI result, any database migration result, and the
deployment URL and smoke-check result.

Vercel Git integration is the intended application deployment path. Keep the
existing `care-record` Production project and `care-record-staging` Preview
project, with separate Supabase projects and environment values. The intended
mapping is Production from `main` in `care-record` and feature-branch Previews in
`care-record-staging`. Project presence has been checked; the Production
project mappings and remaining setup checks are recorded in the
[deployment runbook](docs/deployment-runbook.md); verify them before treating
this path as operational.

Database changes use a manual, backward-compatible, database-first release:

1. Review the migration diff and candidate SHA. Apply the migration to the
   existing staging database and check the relevant Preview behavior.
2. Confirm the linked Supabase project, migration history, and dry-run. Check a
   recent Production backup before applying the same migration to Production.
3. Apply the compatible migration to Production while the current application
   still works with the expanded schema.
4. Merge the PR. Vercel deploys the `main` commit through Git integration.
5. Check `/api/health`, sign-in, and one minimal record save. Use an expand,
   migrate, contract sequence for changes that remove or rename schema.

Application rollback and database recovery are separate operations. Reverting a
Vercel application deployment does not reverse a database migration. Detailed
initial setup, migration, release, monitoring, and rollback steps are in the
[deployment runbook](docs/deployment-runbook.md).

## Checks

The PR runs the configured basic CI checks and any heavier checks selected for
the changed files. Local Supabase E2E uses synthetic data and no cloud E2E
secrets. See [testing](docs/testing.md) for the current scripts and selection
rules, and the [deployment runbook](docs/deployment-runbook.md) for the
external branch-rule status.

Routine release checks are intentionally short. Use the
[release-readiness checklist](docs/release-readiness-checklist.md) for initial
service operation and material changes, and the
[deployment runbook](docs/deployment-runbook.md) for regular releases and
periodic operations.

## Security-sensitive configuration

Set staging and Production variables in their corresponding Vercel projects;
keep their Supabase keys, service-role keys, OAuth credentials, and integration
secrets separate. Never expose server-only values with a `NEXT_PUBLIC_` prefix.
The names and purpose of application variables are listed in `.env.example`.
The active Google token-encryption key must be a random 32-byte value encoded as
base64; keep older keyring entries for decrypting existing tokens during key
rotation. The GAS endpoint must reject stale timestamps and reused nonces and
verify `X-CareRecord-Signature` as HMAC-SHA256 over
`<timestamp>.<nonce>.<request-body>` using `GAS_SHARED_SECRET`.
