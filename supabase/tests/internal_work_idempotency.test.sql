-- Synthetic data only. Run in an authorized disposable local Supabase after migrations.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
SELECT ('47000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue47-' || n || '@example.invalid', 'x', now(), now(), now() FROM generate_series(1,3) n;
INSERT INTO public.profiles (id, name)
SELECT ('47000000-0000-4000-8000-00000000000' || n)::uuid, 'Synthetic actor ' || n FROM generate_series(1,3) n ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organizations (id, name) VALUES
 ('47000000-0000-4000-8000-000000000011', 'Synthetic org A'),
 ('47000000-0000-4000-8000-000000000012', 'Synthetic org B');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
 ('47000000-0000-4000-8000-000000000011', '47000000-0000-4000-8000-000000000001', 'owner'),
 ('47000000-0000-4000-8000-000000000012', '47000000-0000-4000-8000-000000000001', 'owner'),
 ('47000000-0000-4000-8000-000000000011', '47000000-0000-4000-8000-000000000002', 'owner'),
 ('47000000-0000-4000-8000-000000000011', '47000000-0000-4000-8000-000000000003', 'member');
INSERT INTO public.staffs (id, organization_id, user_id, name) VALUES
 ('47000000-0000-4000-8000-000000000021', '47000000-0000-4000-8000-000000000011', '47000000-0000-4000-8000-000000000001', 'Synthetic staff A'),
 ('47000000-0000-4000-8000-000000000022', '47000000-0000-4000-8000-000000000012', '47000000-0000-4000-8000-000000000001', 'Synthetic staff B'),
 ('47000000-0000-4000-8000-000000000023', '47000000-0000-4000-8000-000000000011', '47000000-0000-4000-8000-000000000003', 'Synthetic assigned staff');
INSERT INTO public.organization_roles (id, organization_id, name, permissions) VALUES
 ('47000000-0000-4000-8000-000000000031', '47000000-0000-4000-8000-000000000011', 'Create own only', '{"internalWork":{"create":"assigned","view":"none"}}');
INSERT INTO public.organization_member_roles (organization_id, user_id, role_id) VALUES
 ('47000000-0000-4000-8000-000000000011', '47000000-0000-4000-8000-000000000003', '47000000-0000-4000-8000-000000000031');
INSERT INTO public.user_session_activity (session_hash, auth_session_id, user_id, last_activity, absolute_expires_at)
SELECT 'issue47-hash-' || n, 'issue47-session-' || n, ('47000000-0000-4000-8000-00000000000' || n)::uuid, now(), now() + interval '1 hour' FROM generate_series(1,3) n;

CREATE FUNCTION pg_temp.save_work(
 p_org uuid DEFAULT '47000000-0000-4000-8000-000000000011',
 p_staff uuid DEFAULT '47000000-0000-4000-8000-000000000021',
 p_key uuid DEFAULT '47000000-0000-4000-8000-000000000041',
 p_title text DEFAULT 'Meeting', p_hours numeric DEFAULT 1
) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.save_internal_work_idempotent(p_org, p_staff, p_key, p_title, 'meeting',
 '2026-10-04 01:00:00+00', '2026-10-04 02:00:00+00', p_hours, '')
$$;
GRANT EXECUTE ON FUNCTION pg_temp.save_work(uuid, uuid, uuid, text, numeric) TO authenticated;
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.internal_work_mutation_keys'::regclass), 'key ledger has RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.internal_work_mutation_keys','SELECT,INSERT,UPDATE,DELETE'), 'clients cannot read or mutate ledger');
SELECT ok(NOT has_table_privilege('anon','public.internal_work_mutation_keys','SELECT,INSERT,UPDATE,DELETE'), 'anon cannot read or mutate ledger');
SELECT ok(NOT has_function_privilege('anon','public.save_internal_work_idempotent(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,text)','EXECUTE'), 'anon cannot invoke save');
SELECT ok(has_function_privilege('authenticated','public.save_internal_work_idempotent(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,text)','EXECUTE'), 'authenticated can invoke save');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"issue47-session-1"}', true);
CREATE TEMP TABLE first_result AS SELECT pg_temp.save_work() AS result;
SELECT is((SELECT result->>'replayed' FROM first_result), 'false', 'first save creates');
-- Ignore the first response, then retry the actual RPC, as after response loss.
SELECT is(pg_temp.save_work()->>'id', (SELECT result->>'id' FROM first_result), 'lost response retry returns original ID');
SELECT is(pg_temp.save_work()->>'replayed', 'true', 'retry is explicitly replayed');
SELECT is(pg_temp.save_work(p_title => ' Meeting ', p_hours => 1.00)->>'id', (SELECT result->>'id' FROM first_result), 'normalized equivalent payload replays');
SET LOCAL TIME ZONE 'Asia/Tokyo';
SELECT is(pg_temp.save_work()->>'id', (SELECT result->>'id' FROM first_result), 'hash is independent of session timezone');
SELECT throws_ok($$ SELECT pg_temp.save_work(p_title => 'Different') $$, 'CR409', 'idempotency_key_reused', 'same key with different payload conflicts');
SELECT throws_ok($$ SELECT pg_temp.save_work(p_hours => 2) $$, 'CR409', 'idempotency_key_reused', 'changed hours conflict');
SELECT isnt(pg_temp.save_work(p_key => '47000000-0000-4000-8000-000000000042')->>'id', (SELECT result->>'id' FROM first_result), 'intentional identical record uses a new key');
SELECT isnt(pg_temp.save_work(p_org => '47000000-0000-4000-8000-000000000012', p_staff => '47000000-0000-4000-8000-000000000022')->>'id', (SELECT result->>'id' FROM first_result), 'same actor and key in another authorized org is separate');
SELECT throws_ok($$ SELECT pg_temp.save_work(p_staff => '47000000-0000-4000-8000-000000000022') $$, '42501', 'staff_not_found', 'foreign-org staff rejected before replay');
SELECT set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"issue47-session-2"}', true);
SELECT isnt(pg_temp.save_work()->>'id', (SELECT result->>'id' FROM first_result), 'same org and key for a different actor is separate');
SELECT throws_ok($$ SELECT pg_temp.save_work(p_org => '47000000-0000-4000-8000-000000000012', p_staff => '47000000-0000-4000-8000-000000000022') $$, '42501', 'permission_denied', 'non-member cannot read another org replay');
SELECT set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"issue47-session-3"}', true);
SELECT throws_ok($$ SELECT pg_temp.save_work() $$, '42501', 'permission_denied', 'assigned caller cannot create or replay another staff');
SELECT lives_ok($$ SELECT pg_temp.save_work(p_staff => '47000000-0000-4000-8000-000000000023') $$, 'assigned create without view can save');
SELECT is(pg_temp.save_work(p_staff => '47000000-0000-4000-8000-000000000023')->>'replayed', 'true', 'create-only caller can replay own result');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.internal_work_records WHERE organization_id IN ('47000000-0000-4000-8000-000000000011','47000000-0000-4000-8000-000000000012')), 5::bigint, 'only five distinct operations create rows');
SELECT is((SELECT count(*) FROM public.audit_events WHERE organization_id IN ('47000000-0000-4000-8000-000000000011','47000000-0000-4000-8000-000000000012') AND action_type='internal_work.create'), 5::bigint, 'one creation audit per distinct operation');
-- Inject a synthetic audit failure. throws_ok rolls back the failed RPC subtransaction.
CREATE FUNCTION pg_temp.fail_internal_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action_type='internal_work.create' AND NEW.organization_id='47000000-0000-4000-8000-000000000011' THEN
   RAISE EXCEPTION 'synthetic_audit_failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER issue47_fail_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_internal_audit();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"issue47-session-1"}', true);
SELECT throws_ok($$ SELECT pg_temp.save_work(p_key => '47000000-0000-4000-8000-000000000043') $$, 'P0001', 'synthetic_audit_failure', 'audit failure rolls back persistence');
RESET ROLE;
DROP TRIGGER issue47_fail_audit ON public.audit_events;
SELECT is((SELECT count(*) FROM public.internal_work_records WHERE organization_id IN ('47000000-0000-4000-8000-000000000011','47000000-0000-4000-8000-000000000012')), 5::bigint, 'audit failure leaves no extra record');
SELECT is((SELECT count(*) FROM public.internal_work_mutation_keys WHERE idempotency_key='47000000-0000-4000-8000-000000000043'), 0::bigint, 'audit failure leaves no retry key');
UPDATE public.organization_roles SET permissions='{"internalWork":{"create":"none"}}' WHERE id='47000000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"issue47-session-3"}', true);
SELECT throws_ok($$ SELECT pg_temp.save_work(p_staff => '47000000-0000-4000-8000-000000000023') $$, '42501', 'permission_denied', 'replay rechecks revoked permission');
RESET ROLE;
UPDATE public.user_session_activity SET revoked_at=now() WHERE auth_session_id='issue47-session-1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"47000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"issue47-session-1"}', true);
SELECT throws_ok($$ SELECT pg_temp.save_work() $$, '42501', 'authentication_required', 'replay rejects revoked session');
RESET ROLE;
UPDATE public.user_session_activity SET revoked_at=NULL WHERE auth_session_id='issue47-session-1';
UPDATE public.internal_work_records SET deleted_at=now() WHERE id=(SELECT (result->>'id')::uuid FROM first_result);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT pg_temp.save_work() $$, '42501', 'record_unavailable', 'deleted record never resurrects');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
