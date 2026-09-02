-- GAP-01 independent-audit review fixes: real database contracts.
-- These checks deliberately run as authenticated callers; mocked Server Action
-- tests cannot prove SECURITY DEFINER authorization, RLS preservation, or a
-- transaction rollback across shifts and their segment children.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures: owner (all), a custom-role all user, an assigned-only user, and
-- an outsider.  Every actor has an active session because the contracts must
-- reject stale or invented JWT claims.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('d1111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shift-owner@example.invalid', 'x', now(), now(), now()),
  ('d1111111-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shift-all@example.invalid', 'x', now(), now(), now()),
  ('d1111111-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shift-assigned@example.invalid', 'x', now(), now(), now()),
  ('d1111111-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shift-outsider@example.invalid', 'x', now(), now(), now());
INSERT INTO public.profiles (id, name) VALUES
  ('d1111111-0000-0000-0000-000000000001', 'Shift Owner'),
  ('d1111111-0000-0000-0000-000000000002', 'Shift All'),
  ('d1111111-0000-0000-0000-000000000003', 'Shift Assigned'),
  ('d1111111-0000-0000-0000-000000000004', 'Shift Outsider')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
INSERT INTO public.organizations (id, name) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'Shift Contract Org A'),
  ('d0000000-0000-0000-0000-00000000000b', 'Shift Contract Org B');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'd1111111-0000-0000-0000-000000000001', 'owner'),
  ('d0000000-0000-0000-0000-00000000000a', 'd1111111-0000-0000-0000-000000000002', 'member'),
  ('d0000000-0000-0000-0000-00000000000a', 'd1111111-0000-0000-0000-000000000003', 'member');
INSERT INTO public.organization_roles (id, organization_id, name, color, is_preset, permissions) VALUES
  ('d2222222-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'Shift all', '#111111', false, '{"shifts":{"view":"all","edit":"all","delete":"all"}}'::jsonb),
  ('d2222222-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a', 'Shift assigned', '#222222', false, '{"shifts":{"view":"assigned","edit":"assigned","delete":"assigned"}}'::jsonb);
INSERT INTO public.organization_member_roles (organization_id, user_id, role_id) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'd1111111-0000-0000-0000-000000000002', 'd2222222-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-00000000000a', 'd1111111-0000-0000-0000-000000000003', 'd2222222-0000-0000-0000-000000000002');
INSERT INTO public.user_session_activity (session_hash, auth_session_id, user_id, last_activity, absolute_expires_at) VALUES
  ('shift-owner-hash', 'shift-owner-session', 'd1111111-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('shift-all-hash', 'shift-all-session', 'd1111111-0000-0000-0000-000000000002', now(), now() + interval '1 hour'),
  ('shift-assigned-hash', 'shift-assigned-session', 'd1111111-0000-0000-0000-000000000003', now(), now() + interval '1 hour');
INSERT INTO public.clients (id, organization_id, name) VALUES
  ('d3333333-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', 'Client A'),
  ('d3333333-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b', 'Client B');
INSERT INTO public.staffs (id, organization_id, name) VALUES
  ('d4444444-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', 'Staff A');
INSERT INTO public.shifts (id, organization_id, client_id, title, start_at, end_at, status, google_event_id, google_sync_status, deleted_at, deletion_reason, retention_until)
VALUES
  ('d5555555-0000-0000-0000-000000000101', 'd0000000-0000-0000-0000-00000000000a', 'd3333333-0000-0000-0000-00000000000a', 'Active one', '2026-09-02 09:00+00', '2026-09-02 10:00+00', 'published', 'event-active-one', 'synced', NULL, NULL, NULL),
  ('d5555555-0000-0000-0000-000000000102', 'd0000000-0000-0000-0000-00000000000a', 'd3333333-0000-0000-0000-00000000000a', 'Active two', '2026-09-02 10:00+00', '2026-09-02 11:00+00', 'published', 'event-active-two', 'synced', NULL, NULL, NULL),
  ('d5555555-0000-0000-0000-000000000103', 'd0000000-0000-0000-0000-00000000000a', 'd3333333-0000-0000-0000-00000000000a', 'Deleted pending', '2026-09-02 11:00+00', '2026-09-02 12:00+00', 'published', 'event-pending', 'pending_delete', now(), 'original reason', now() + interval '5 years'),
  ('d5555555-0000-0000-0000-000000000104', 'd0000000-0000-0000-0000-00000000000a', 'd3333333-0000-0000-0000-00000000000a', 'Deleted failed', '2026-09-02 12:00+00', '2026-09-02 13:00+00', 'published', NULL, 'failed', now(), 'failed reason', now() + interval '5 years'),
  ('d5555555-0000-0000-0000-000000000105', 'd0000000-0000-0000-0000-00000000000a', 'd3333333-0000-0000-0000-00000000000a', 'Deleted complete', '2026-09-02 13:00+00', '2026-09-02 14:00+00', 'published', NULL, 'synced', now(), 'complete reason', now() + interval '5 years'),
  ('d5555555-0000-0000-0000-000000000106', 'd0000000-0000-0000-0000-00000000000a', 'd3333333-0000-0000-0000-00000000000a', 'Segment target', '2026-09-03 09:00+00', '2026-09-03 10:00+00', 'published', NULL, 'synced', NULL, NULL, NULL),
  ('d5555555-0000-0000-0000-000000000107', 'd0000000-0000-0000-0000-00000000000a', 'd3333333-0000-0000-0000-00000000000a', 'Rollback target', '2026-09-03 10:00+00', '2026-09-03 11:00+00', 'published', NULL, 'synced', NULL, NULL, NULL),
  ('d5555555-0000-0000-0000-000000000201', 'd0000000-0000-0000-0000-00000000000b', 'd3333333-0000-0000-0000-00000000000b', 'Foreign shift', '2026-09-03 11:00+00', '2026-09-03 12:00+00', 'published', NULL, 'synced', NULL, NULL, NULL);
INSERT INTO public.shift_segments (id, shift_id, start_at, end_at, sort_order) VALUES
  ('d6666666-0000-0000-0000-000000000106', 'd5555555-0000-0000-0000-000000000106', '2026-09-03 09:00+00', '2026-09-03 10:00+00', 0),
  ('d6666666-0000-0000-0000-000000000107', 'd5555555-0000-0000-0000-000000000107', '2026-09-03 10:00+00', '2026-09-03 11:00+00', 0);
INSERT INTO public.shift_segment_staffs (segment_id, staff_id) VALUES
  ('d6666666-0000-0000-0000-000000000106', 'd4444444-0000-0000-0000-00000000000a'),
  ('d6666666-0000-0000-0000-000000000107', 'd4444444-0000-0000-0000-00000000000a');

-- The recovery RPC is not callable without a real authenticated session.
SELECT throws_ok(
  $$ SELECT public.list_deleted_shift_google_sync_targets('d0000000-0000-0000-0000-00000000000a') $$,
  'P0001', 'authentication required', 'deleted sync targets require authentication');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d1111111-0000-0000-0000-000000000001","role":"authenticated","session_id":"shift-owner-session"}', true);

-- Ordinary SELECT still conceals the soft-deleted rows; only the bounded RPC
-- may reveal a non-PII recovery cursor to an all-scope caller.
SELECT is((SELECT count(*)::bigint FROM public.shifts WHERE id IN ('d5555555-0000-0000-0000-000000000103', 'd5555555-0000-0000-0000-000000000104')),
  0::bigint, 'normal shift SELECT remains unable to read deleted rows');
SELECT is((SELECT array_agg(shift_id ORDER BY shift_id) FROM public.list_deleted_shift_google_sync_targets('d0000000-0000-0000-0000-00000000000a', NULL, 50)),
  ARRAY['d5555555-0000-0000-0000-000000000103'::uuid, 'd5555555-0000-0000-0000-000000000104'::uuid],
  'recovery RPC returns only pending_delete and failed rows');
SELECT is((SELECT count(*)::bigint FROM public.list_deleted_shift_google_sync_targets('d0000000-0000-0000-0000-00000000000a', 'd5555555-0000-0000-0000-000000000103', 50)),
  1::bigint, 'recovery RPC honours its opaque pagination cursor');
SELECT is((SELECT remaining FROM public.list_deleted_shift_google_sync_targets('d0000000-0000-0000-0000-00000000000a', NULL, 1) LIMIT 1),
  1::bigint, 'recovery RPC returns remaining count without an event identifier');
SELECT throws_ok(
  $$ SELECT public.list_deleted_shift_google_sync_targets('d0000000-0000-0000-0000-00000000000a', NULL, 51) $$,
  'P0001', 'invalid sync target limit', 'recovery RPC bounds page size');
SELECT throws_ok(
  $$ SELECT public.list_deleted_shift_google_sync_targets('d0000000-0000-0000-0000-00000000000b') $$,
  'P0001', 'shift sync permission required', 'recovery RPC rejects cross-organization access');

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-0000-0000-0000-000000000003","role":"authenticated","session_id":"shift-assigned-session"}', true);
SELECT throws_ok(
  $$ SELECT public.list_deleted_shift_google_sync_targets('d0000000-0000-0000-0000-00000000000a') $$,
  'P0001', 'shift sync permission required', 'assigned-only user cannot enumerate deleted recovery targets');
SELECT throws_ok(
  $$ SELECT public.soft_delete_shifts_checked('d0000000-0000-0000-0000-00000000000a', ARRAY['d5555555-0000-0000-0000-000000000101']::uuid[], 'blocked', now(), 'pending_delete') $$,
  'P0001', 'shift delete permission required', 'assigned-only user cannot invoke bulk delete contract');

SELECT set_config('request.jwt.claims', '{"sub":"d1111111-0000-0000-0000-000000000002","role":"authenticated","session_id":"shift-all-session"}', true);
SELECT is((SELECT (public.soft_delete_shifts_checked(
  'd0000000-0000-0000-0000-00000000000a',
  ARRAY['d5555555-0000-0000-0000-000000000101', 'd5555555-0000-0000-0000-000000000102', 'd5555555-0000-0000-0000-000000000101']::uuid[],
  'bulk removal', now() + interval '5 years', 'pending_delete')->>'requested')::integer),
  2, 'bulk delete de-duplicates requested IDs before classification');
SELECT is((SELECT google_sync_status FROM public.shifts WHERE id='d5555555-0000-0000-0000-000000000101'),
  'pending_delete', 'bulk delete queues the Google deletion after committing the DB mutation');
SELECT is((SELECT deletion_reason FROM public.shifts WHERE id='d5555555-0000-0000-0000-000000000102'),
  'bulk removal', 'bulk delete writes metadata for newly deleted rows');
SELECT is((SELECT (public.soft_delete_shifts_checked(
  'd0000000-0000-0000-0000-00000000000a', ARRAY['d5555555-0000-0000-0000-000000000101']::uuid[],
  'must not overwrite', now(), 'synced')->>'already_deleted')::integer),
  1, 'repeated bulk delete is idempotent');
RESET ROLE;
SELECT is((SELECT deletion_reason FROM public.shifts WHERE id='d5555555-0000-0000-0000-000000000101'),
  'bulk removal', 'idempotent bulk delete leaves original deletion metadata intact');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d1111111-0000-0000-0000-000000000002","role":"authenticated","session_id":"shift-all-session"}', true);
SELECT throws_ok(
  $$ SELECT public.soft_delete_shifts_checked(
       'd0000000-0000-0000-0000-00000000000a',
       ARRAY['d5555555-0000-0000-0000-000000000106', 'd5555555-0000-0000-0000-000000000201']::uuid[],
       'mixed org', now(), 'pending_delete') $$,
  'P0001', 'shift delete targets not found or outside organization', 'mixed-organization chunk aborts before any row is modified');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NULL FROM public.shifts WHERE id='d5555555-0000-0000-0000-000000000106'),
  'rollback leaves the same-organization row active after a mixed chunk failure');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"d1111111-0000-0000-0000-000000000002","role":"authenticated","session_id":"shift-all-session"}', true);
SELECT throws_ok(
  $$ SELECT public.soft_delete_shifts_checked('d0000000-0000-0000-0000-00000000000a', ARRAY[NULL::uuid], 'invalid', now(), 'pending_delete') $$,
  'P0001', 'invalid shift delete targets', 'bulk delete rejects null IDs');
SELECT is(public.soft_delete_shifts_atomic(
  'd0000000-0000-0000-0000-00000000000a', ARRAY['d5555555-0000-0000-0000-000000000107']::uuid[],
  'legacy wrapper', now() + interval '5 years', 'pending_delete'),
  1, 'legacy integer bulk-delete RPC delegates to the checked contract');

-- A parent update and child segment replacement commit together.  Omission
-- keeps segments, [] removes them, and a child validation failure rolls back
-- a simultaneously requested field update.
SELECT is(public.update_shift_with_segments_atomic(
  'd0000000-0000-0000-0000-00000000000a', 'd5555555-0000-0000-0000-000000000106',
  '{"status":"cancelled","title":"untrusted"}'::jsonb, false, NULL),
  'updated', 'field update succeeds when segments are omitted');
SELECT is((SELECT count(*)::bigint FROM public.shift_segments WHERE shift_id='d5555555-0000-0000-0000-000000000106'),
  1::bigint, 'omitted segments preserve existing child rows');
SELECT is((SELECT title FROM public.shifts WHERE id='d5555555-0000-0000-0000-000000000106'),
  'Client A (Staff A)', 'final shift title is derived from client and segment staff');
SELECT is(public.update_shift_with_segments_atomic(
  'd0000000-0000-0000-0000-00000000000a', 'd5555555-0000-0000-0000-000000000106',
  '{}'::jsonb, true, '[]'::jsonb),
  'updated', 'empty segments array is an intentional replacement');
SELECT is((SELECT count(*)::bigint FROM public.shift_segments WHERE shift_id='d5555555-0000-0000-0000-000000000106'),
  0::bigint, 'empty segments array deletes all child rows');
SELECT throws_ok(
  $$ SELECT public.update_shift_with_segments_atomic(
       'd0000000-0000-0000-0000-00000000000a', 'd5555555-0000-0000-0000-000000000106',
       '{}'::jsonb, true, NULL) $$,
  'P0001', 'segments must be an array', 'explicit segment replacement rejects null');
SELECT throws_ok(
  $$ SELECT public.update_shift_with_segments_atomic(
       'd0000000-0000-0000-0000-00000000000a', 'd5555555-0000-0000-0000-000000000107',
       '{"status":"cancelled"}'::jsonb, true,
       '[{"start_at":"2026-09-03T12:00:00Z","end_at":"2026-09-03T11:00:00Z","staffs":[]}]'::jsonb) $$,
  'P0001', 'segment end must be after start', 'child validation error aborts the parent update');
RESET ROLE;
SELECT is((SELECT status FROM public.shifts WHERE id='d5555555-0000-0000-0000-000000000107'),
  'published', 'failed child replacement rolls back parent fields');
SELECT is((SELECT count(*)::bigint FROM public.shift_segments WHERE shift_id='d5555555-0000-0000-0000-000000000107'),
  1::bigint, 'failed child replacement keeps prior segment rows');

SELECT * FROM finish();
ROLLBACK;
