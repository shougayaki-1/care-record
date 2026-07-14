# Task 1 Report: offices テーブルのマイグレーション

## What I implemented

Created `supabase/migrations/20260705000000_offices.sql` exactly as specified in the task brief:

- `public.offices` table: `id`, `organization_id` (FK -> organizations, ON DELETE CASCADE), `name`,
  `travel_cost_rate_yen_per_km numeric(8,2)` (default 20, check 0-10000), `archived_at`, `created_at`, `updated_at`.
- RLS enabled on `offices`; policy `"Org members read offices"` (SELECT, `authenticated`,
  `private.is_org_member(organization_id) AND archived_at IS NULL`) — matches the exact pattern used by
  `service_types` and `staff_roles` in `20260630235959_init.sql`.
- `GRANT SELECT` to `authenticated`, `GRANT ALL` to `service_role`.
- New nullable `office_id uuid` columns on `public.clients` and `public.staffs`, each with an FK to
  `offices(id) ON DELETE RESTRICT`.
- Backfill `DO $$ ... $$` block: for every non-deleted organization, creates one office carrying over
  the org's current name and `travel_cost_rate_yen_per_km`, then assigns all of that org's clients/staffs
  (where `office_id IS NULL`) to the new office.

No application code was touched — this task is schema-only per the brief.

## What I tested / verified

A local Supabase instance **was** available in this environment (Docker daemon was running; the DB
container had exited but `supabase start` brought it back up cleanly). I ran real verification, not just
static SQL review:

1. `supabase migration up` — applied `20260705000000_offices.sql` successfully, no errors.
2. `supabase db reset` — full clean re-apply of all migrations including the new one, succeeded.
3. Backfill check via `supabase db query`:
   `offices_count=0, orgs_count=0, null_staffs=0, null_clients=0` — the local seed DB has no organizations,
   so counts are trivially consistent (0 orgs -> 0 offices, 0 null office_ids). This confirms the DO block
   runs without error on an empty dataset but does **not** exercise the actual backfill-with-data path
   (no seeded orgs/clients/staffs existed to backfill in this environment; there is no `supabase/seed.sql`).
4. Verified schema directly against `information_schema`/`pg_constraint`/`pg_policies` in the running DB:
   - `offices` columns and types match the brief exactly.
   - Constraints present: `offices_pkey`, `offices_organization_id_fkey`, `offices_travel_cost_rate_yen_per_km_check`.
   - `clients_office_id_fkey` and `staffs_office_id_fkey` both exist.
   - Policy `"Org members read offices"` exists, cmd=SELECT.
5. Ran `supabase test db` (executes `supabase/tests/security_hardening.test.sql` via pgTAP) both **with**
   and **without** my migration applied (temporarily moved the migration file aside and did a full
   `db reset` to isolate). Result: test #13 ("operational tables require an active server session",
   expects count=15) **fails identically in both cases** — this is a pre-existing failure on the base
   branch, unrelated to my change. My migration does not add a `"Require active server session"` policy
   to `offices`, so it cannot be the cause, and the failure reproduces with the migration file entirely
   removed from disk.
6. `npm run typecheck` — passes clean (expected, since no `.ts`/`.tsx` files were touched).
7. Did not run `npm run lint`, `npm run test:unit`, or `npm run test:e2e` — no application code changed,
   and `test:e2e` requires a dedicated E2E env per project rules (not run without explicit request).

## Files changed

- `supabase/migrations/20260705000000_offices.sql` (new, 59 lines)

## Step 4 decision: security_hardening.test.sql

Read the full file (55 lines). It does not contain per-table pgTAP cases like "org members can read X /
non-members cannot" for `service_types` or `staff_roles` (the two existing tables with the same
`private.is_org_member(...) AND archived_at/deleted_at IS NULL` RLS shape) — there's no established
per-table RLS pattern to copy for `offices`. The file instead does three things: (a) a blanket
`bool_and(relrowsecurity)` check that all public tables have RLS enabled — `offices` is automatically
covered by this since RLS is enabled in my migration; (b) fixed-count assertions over a hardcoded list of
15 "operational tables" tied to the `"Authenticated read base"` / `"Require active server session"` /
"Tenant boundary ..." policy triad, which `offices` deliberately does not participate in (it uses the
simpler `Org members read offices` pattern like `service_types`/`staff_roles`, which are also absent from
that list); (c) a few table-specific privilege/trigger checks unrelated to offices. Given no existing
per-table pattern applies and the blanket RLS-enabled check already covers `offices`, I made no changes
to this file, consistent with how `service_types` and `staff_roles` were introduced without dedicated
test additions.

## Self-review

- Completeness: table, columns, constraints, RLS policy, grants, FK columns on clients/staffs, backfill
  DO block — all present, matching the brief verbatim.
- Quality: naming and quoting style matches `20260630235959_init.sql` exactly (double-quoted identifiers,
  `ALTER TABLE ONLY` for post-creation constraints, same RLS/grant ordering as other master-data tables).
- Discipline: no application code changes, no edits to existing migration files, `supabase/migrations/old/`
  untouched, no physical DELETE anywhere, only one new file created and committed.
- Verification is real: migration applied and reset against a live local Postgres instance, schema
  introspected via SQL queries against the actual running database (not assumed from reading the file).

## Issues / concerns

- The backfill step (Step 3 of the brief) could only be confirmed to be "safe on empty data"; it was not
  exercised against a populated dataset (no seeded organizations/clients/staffs existed in this local
  environment). The DO block's logic (loop per org, insert office, backfill client/staff FKs where null)
  was manually reviewed and looks correct, but a run against realistic multi-org/multi-client data would
  give stronger confidence.
- Pre-existing pgTAP test failure (`security_hardening.test.sql` test #13, plan-count mismatch expecting
  14 vs actual 15 subtests) exists on the base branch independent of this change — flagged here for
  visibility but out of scope to fix under this task ("no scope creep").
