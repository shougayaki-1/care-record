-- RPC contract tests for the incident-history SECURITY DEFINER RPCs.
--
-- Why this file exists (see docs / plan PR5): the app calls these RPCs by NAME
-- with NAMED arguments through PostgREST. Generated TypeScript types (PR4) cannot
-- guard PostgREST function resolution (the 42883 overload class), RLS semantics,
-- or the owner/permission rules baked into the function bodies. The existing unit
-- tests mock supabase entirely, so a DB-logic regression like 31dce49
-- (owner not counted as a role manager) is invisible to them. These tests run the
-- real functions against the real schema under the `authenticated` role.
--
-- Style mirrors supabase/tests/security_hardening.test.sql:
--   SET LOCAL ROLE authenticated + set_config('request.jwt.claims', ...) to pick
--   the acting user; throws_ok/lives_ok/is/ok for assertions; whole file runs in a
--   transaction that ROLLBACKs at the end so no data survives.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Org A: role/account management scenarios.
--   a1 owner (implicit role manager, no explicit member_roles link)
--   a2 non-owner accounts manager (linked to a dangerous 'accounts' role)
--   a3 non-owner role manager (linked to a 'roles' role)
--   a4 plain member (target of role assignment)
-- Org B: a freshly created org whose owner has NO explicit member_roles row.
--   Reproduces the 31dce49 last_role_manager regression precondition.
-- Org C: owner transfer scenario (c1 owner, c2 member).

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('a1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@example.invalid', 'x', now(), now(), now()),
  ('a2222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2@example.invalid', 'x', now(), now(), now()),
  ('a3333333-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a3@example.invalid', 'x', now(), now(), now()),
  ('a4444444-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4@example.invalid', 'x', now(), now(), now()),
  ('b1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b1@example.invalid', 'x', now(), now(), now()),
  ('c1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c1@example.invalid', 'x', now(), now(), now()),
  ('c2222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c2@example.invalid', 'x', now(), now(), now());

INSERT INTO public.profiles (id, name) VALUES
  ('a1111111-0000-0000-0000-000000000001', 'Owner A'),
  ('a2222222-0000-0000-0000-000000000002', 'Accounts Manager A'),
  ('a3333333-0000-0000-0000-000000000003', 'Role Manager A'),
  ('a4444444-0000-0000-0000-000000000004', 'Member A'),
  ('b1111111-0000-0000-0000-000000000001', 'Owner B'),
  ('c1111111-0000-0000-0000-000000000001', 'Owner C'),
  ('c2222222-0000-0000-0000-000000000002', 'Member C')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.organizations (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Contract Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Contract Org B'),
  ('cccccccc-0000-0000-0000-00000000000c', 'Contract Org C');

INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a1111111-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a2222222-0000-0000-0000-000000000002', 'member'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a3333333-0000-0000-0000-000000000003', 'member'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a4444444-0000-0000-0000-000000000004', 'member'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'b1111111-0000-0000-0000-000000000001', 'owner'),
  ('cccccccc-0000-0000-0000-00000000000c', 'c1111111-0000-0000-0000-000000000001', 'owner'),
  ('cccccccc-0000-0000-0000-00000000000c', 'c2222222-0000-0000-0000-000000000002', 'member');

-- Org A roles: a normal (safe) role, a dangerous 'accounts' role, a 'roles' role.
INSERT INTO public.organization_roles (id, organization_id, name, color, is_preset, permissions) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Normal',        '#111111', false, '{"management":{}}'::jsonb),
  ('a0000002-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Accounts role', '#222222', false, '{"management":{"accounts":true}}'::jsonb),
  ('a0000003-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Roles role',    '#333333', false, '{"management":{"roles":true}}'::jsonb);

-- a2 is a non-owner accounts manager; a3 is a non-owner role manager.
INSERT INTO public.organization_member_roles (organization_id, user_id, role_id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a2222222-0000-0000-0000-000000000002', 'a0000002-0000-0000-0000-000000000002'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a3333333-0000-0000-0000-000000000003', 'a0000003-0000-0000-0000-000000000003');

-- Active sessions for every actor (some RPCs require private.is_session_active()).
INSERT INTO public.user_session_activity (session_hash, auth_session_id, user_id, last_activity, absolute_expires_at) VALUES
  ('a1-hash', 'a1-sess', 'a1111111-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('a2-hash', 'a2-sess', 'a2222222-0000-0000-0000-000000000002', now(), now() + interval '1 hour'),
  ('a3-hash', 'a3-sess', 'a3333333-0000-0000-0000-000000000003', now(), now() + interval '1 hour'),
  ('a4-hash', 'a4-sess', 'a4444444-0000-0000-0000-000000000004', now(), now() + interval '1 hour'),
  ('b1-hash', 'b1-sess', 'b1111111-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('c1-hash', 'c1-sess', 'c1111111-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('c2-hash', 'c2-sess', 'c2222222-0000-0000-0000-000000000002', now(), now() + interval '1 hour');

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- save_report_versioned (entry point that wraps the 42883-prone
-- save_report_atomic_v2). We assert the named-argument signature resolves and
-- its early guards fire, without building the full report/version fixture.
-- A clean business error here proves PostgREST can resolve the 15-arg overload
-- exactly as reports.ts calls it — i.e. no "function does not exist" (42883).
-- ===========================================================================
SELECT set_config('request.jwt.claims', '{"sub":"a1111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"a1-sess"}', true);
SELECT throws_ok(
  $$ SELECT public.save_report_versioned(
       'aaaaaaaa-0000-0000-0000-00000000000a', NULL, NULL, NULL, NULL,
       now(), now(), 'draft', '{}'::jsonb,
       0::bigint, NULL::uuid, NULL, NULL, '[]'::jsonb, NULL) $$,
  'P0001', 'version_and_idempotency_required',
  'save_report_versioned resolves via named args and enforces the version/idempotency contract');

-- ===========================================================================
-- mutate_organization_role_authorized (roles.ts create/update/delete/reset)
-- ===========================================================================
SELECT lives_ok(
  $$ SELECT public.mutate_organization_role_authorized(
       'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'create', 'New Safe Role', '#444444', '{"management":{}}'::jsonb, false) $$,
  'owner can create a role (owner is counted as a role manager, so no last_role_manager error)');

SELECT set_config('request.jwt.claims', '{"sub":"a4444444-0000-0000-0000-000000000004","role":"authenticated","session_id":"a4-sess"}', true);
SELECT throws_ok(
  $$ SELECT public.mutate_organization_role_authorized(
       'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'create', 'Blocked Role', '#555555', '{"management":{}}'::jsonb, false) $$,
  '42501', 'permission_denied',
  'a member without the roles permission cannot mutate roles');

SELECT set_config('request.jwt.claims', '{"sub":"a3333333-0000-0000-0000-000000000003","role":"authenticated","session_id":"a3-sess"}', true);
SELECT throws_ok(
  $$ SELECT public.mutate_organization_role_authorized(
       'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'create', 'Dangerous By Non Owner', '#666666', '{"management":{"accounts":true}}'::jsonb, false) $$,
  '42501', 'owner_required',
  'a non-owner role manager cannot create a role carrying dangerous permissions');

SELECT set_config('request.jwt.claims', '{"sub":"a1111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"a1-sess"}', true);
SELECT lives_ok(
  $$ SELECT public.mutate_organization_role_authorized(
       'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'create', 'Dangerous By Owner', '#777777', '{"management":{"accounts":true}}'::jsonb, false) $$,
  'owner can create a role carrying dangerous permissions');

-- 31dce49 regression: a freshly created org's owner has no explicit
-- organization_member_roles row, yet must count as a role manager so the very
-- first role mutation does not raise last_role_manager.
SELECT set_config('request.jwt.claims', '{"sub":"b1111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"b1-sess"}', true);
SELECT lives_ok(
  $$ SELECT public.mutate_organization_role_authorized(
       'bbbbbbbb-0000-0000-0000-00000000000b', NULL, 'create', 'First Role', '#888888', '{"management":{}}'::jsonb, false) $$,
  'owner of a fresh org (no explicit member_roles) can create the first role without last_role_manager');

-- ===========================================================================
-- transfer_owner_atomic (organization.ts)
-- ===========================================================================
SELECT set_config('request.jwt.claims', '{"sub":"c2222222-0000-0000-0000-000000000002","role":"authenticated","session_id":"c2-sess"}', true);
SELECT throws_ok(
  $$ SELECT public.transfer_owner_atomic(
       'cccccccc-0000-0000-0000-00000000000c',
       'c1111111-0000-0000-0000-000000000001',
       'c2222222-0000-0000-0000-000000000002') $$,
  'P0001', 'permission_denied',
  'a non-owner cannot transfer ownership');

SELECT set_config('request.jwt.claims', '{"sub":"c1111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"c1-sess"}', true);
SELECT throws_ok(
  $$ SELECT public.transfer_owner_atomic(
       'cccccccc-0000-0000-0000-00000000000c',
       'a1111111-0000-0000-0000-000000000001',
       'c1111111-0000-0000-0000-000000000001') $$,
  'P0001', 'target_not_member',
  'ownership cannot be transferred to a non-member');

SELECT lives_ok(
  $$ SELECT public.transfer_owner_atomic(
       'cccccccc-0000-0000-0000-00000000000c',
       'c2222222-0000-0000-0000-000000000002',
       'c1111111-0000-0000-0000-000000000001') $$,
  'owner can transfer ownership to an existing member');

RESET ROLE;
SELECT is(
  (SELECT role FROM public.organization_members WHERE organization_id='cccccccc-0000-0000-0000-00000000000c' AND user_id='c2222222-0000-0000-0000-000000000002'),
  'owner', 'transfer promotes the target member to owner');
SELECT is(
  (SELECT role FROM public.organization_members WHERE organization_id='cccccccc-0000-0000-0000-00000000000c' AND user_id='c1111111-0000-0000-0000-000000000001'),
  'member', 'transfer demotes the former owner to member');

-- ===========================================================================
-- account_replace_member_roles (accounts.ts) — also fixes the contract that
-- the app calls it with the named argument p_target_user_id.
-- ===========================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a2222222-0000-0000-0000-000000000002","role":"authenticated","session_id":"a2-sess"}', true);
SELECT lives_ok(
  $$ SELECT public.account_replace_member_roles(
       p_organization_id => 'aaaaaaaa-0000-0000-0000-00000000000a',
       p_target_user_id  => 'a4444444-0000-0000-0000-000000000004',
       p_role_ids        => ARRAY['a0000001-0000-0000-0000-000000000001']::uuid[]) $$,
  'accounts manager can assign a non-dangerous role via the p_target_user_id named contract');

SELECT throws_ok(
  $$ SELECT public.account_replace_member_roles(
       'aaaaaaaa-0000-0000-0000-00000000000a',
       'a4444444-0000-0000-0000-000000000004',
       ARRAY['a0000002-0000-0000-0000-000000000002']::uuid[]) $$,
  'P0001', 'owner_required',
  'a non-owner accounts manager cannot assign a dangerous role');

SELECT throws_ok(
  $$ SELECT public.account_replace_member_roles(
       'aaaaaaaa-0000-0000-0000-00000000000a',
       '00000000-0000-0000-0000-0000000000ff',
       ARRAY['a0000001-0000-0000-0000-000000000001']::uuid[]) $$,
  'P0001', 'member_not_found',
  'assigning roles to a non-member is rejected');

SELECT set_config('request.jwt.claims', '{"sub":"a1111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"a1-sess"}', true);
SELECT lives_ok(
  $$ SELECT public.account_replace_member_roles(
       'aaaaaaaa-0000-0000-0000-00000000000a',
       'a4444444-0000-0000-0000-000000000004',
       ARRAY['a0000002-0000-0000-0000-000000000002']::uuid[]) $$,
  'owner can assign a dangerous role');

-- ===========================================================================
-- Contract / GRANT drift guards. These pin the exact GRANTed signatures so a
-- future overload, argument rename, or GRANT change is caught at CI (this is the
-- structural defense against the 42883 class that generated types cannot give).
-- ===========================================================================
RESET ROLE;
SELECT ok(has_function_privilege('authenticated',
  'public.save_report_versioned(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,bigint,uuid,text,uuid,jsonb,text)', 'EXECUTE'),
  'authenticated may execute save_report_versioned (15-arg signature)');
SELECT ok(NOT has_function_privilege('anon',
  'public.save_report_versioned(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,bigint,uuid,text,uuid,jsonb,text)', 'EXECUTE'),
  'anon cannot execute save_report_versioned');
SELECT ok(has_function_privilege('authenticated',
  'public.save_report_atomic_v2(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated may execute save_report_atomic_v2 (12-arg signature)');
SELECT ok(NOT has_function_privilege('anon',
  'public.save_report_atomic_v2(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,uuid,jsonb)', 'EXECUTE'),
  'anon cannot execute save_report_atomic_v2');
SELECT ok(has_function_privilege('authenticated',
  'public.save_report_atomic(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,uuid,jsonb)', 'EXECUTE'),
  'authenticated retains legacy save_report_atomic until external-use review completes');
SELECT ok(has_function_privilege('service_role',
  'public.save_report_atomic(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,uuid,jsonb)', 'EXECUTE'),
  'service role retains the legacy implementation for controlled internal use');
SELECT ok(has_function_privilege('authenticated',
  'public.mutate_organization_role_authorized(uuid,uuid,text,text,text,jsonb,boolean)', 'EXECUTE'),
  'authenticated may execute mutate_organization_role_authorized');
SELECT ok(NOT has_function_privilege('anon',
  'public.mutate_organization_role_authorized(uuid,uuid,text,text,text,jsonb,boolean)', 'EXECUTE'),
  'anon cannot execute mutate_organization_role_authorized');
SELECT ok(has_function_privilege('authenticated',
  'public.transfer_owner_atomic(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated may execute transfer_owner_atomic');
SELECT ok(NOT has_function_privilege('anon',
  'public.transfer_owner_atomic(uuid,uuid,uuid)', 'EXECUTE'),
  'anon cannot execute transfer_owner_atomic');
SELECT ok(has_function_privilege('authenticated',
  'public.account_replace_member_roles(uuid,uuid,uuid[])', 'EXECUTE'),
  'authenticated may execute account_replace_member_roles');
SELECT ok(NOT has_function_privilege('anon',
  'public.account_replace_member_roles(uuid,uuid,uuid[])', 'EXECUTE'),
  'anon cannot execute account_replace_member_roles');

SELECT * FROM finish();
ROLLBACK;
