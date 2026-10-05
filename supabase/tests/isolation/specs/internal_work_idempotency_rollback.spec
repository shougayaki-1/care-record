# PostgreSQL isolationtester spec; dedicated disposable local database ONLY.
# Setup is committed so both sessions see it. Each permutation needs a fresh DB.
# No teardown deletion: discard the authorized disposable test environment.
setup
{

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
SELECT ('48000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'issue47-rollback-' || n || '@example.invalid', 'x', now(), now(), now() FROM generate_series(1,3) n;
INSERT INTO public.profiles (id, name)
SELECT ('48000000-0000-4000-8000-00000000000' || n)::uuid, 'Synthetic actor ' || n FROM generate_series(1,3) n ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organizations (id, name) VALUES
 ('48000000-0000-4000-8000-000000000011', 'Synthetic org A'),
 ('48000000-0000-4000-8000-000000000012', 'Synthetic org B');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
 ('48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000001', 'owner'),
 ('48000000-0000-4000-8000-000000000012', '48000000-0000-4000-8000-000000000001', 'owner'),
 ('48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000002', 'owner'),
 ('48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000003', 'member');
INSERT INTO public.staffs (id, organization_id, user_id, name) VALUES
 ('48000000-0000-4000-8000-000000000021', '48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000001', 'Synthetic staff A'),
 ('48000000-0000-4000-8000-000000000022', '48000000-0000-4000-8000-000000000012', '48000000-0000-4000-8000-000000000001', 'Synthetic staff B'),
 ('48000000-0000-4000-8000-000000000023', '48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000003', 'Synthetic assigned staff');
INSERT INTO public.organization_roles (id, organization_id, name, permissions) VALUES
 ('48000000-0000-4000-8000-000000000031', '48000000-0000-4000-8000-000000000011', 'Create own only', '{"internalWork":{"create":"assigned","view":"none"}}');
INSERT INTO public.organization_member_roles (organization_id, user_id, role_id) VALUES
 ('48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000003', '48000000-0000-4000-8000-000000000031');
INSERT INTO public.user_session_activity (session_hash, auth_session_id, user_id, last_activity, absolute_expires_at)
SELECT 'issue47-rollback-hash-' || n, 'issue47-rollback-session-' || n, ('48000000-0000-4000-8000-00000000000' || n)::uuid, now(), now() + interval '1 hour' FROM generate_series(1,3) n;

}
session "writer"
step "begin_writer" { BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"issue47-rollback-session-1"}', true); }
step "save_writer" { DO $$ BEGIN PERFORM public.save_internal_work_idempotent('48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000021', '48000000-0000-4000-8000-000000000041', 'Meeting', 'meeting', '2026-10-04 01:00:00+00', '2026-10-04 02:00:00+00', 1, ''); END $$; }
step "commit_writer" { COMMIT; }
step "rollback_writer" { ROLLBACK; }

session "retry"
step "begin_retry" { BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"issue47-rollback-session-1"}', true); }
step "save_retry" { DO $$ DECLARE result jsonb; BEGIN result := public.save_internal_work_idempotent('48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000021', '48000000-0000-4000-8000-000000000041', 'Meeting', 'meeting', '2026-10-04 01:00:00+00', '2026-10-04 02:00:00+00', 1, ''); IF result->>'replayed' <> 'false' OR (result->>'id')::uuid <> ((public.save_internal_work_idempotent('48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000021', '48000000-0000-4000-8000-000000000041', 'Meeting', 'meeting', '2026-10-04 01:00:00+00', '2026-10-04 02:00:00+00', 1, ''))->>'id')::uuid THEN RAISE EXCEPTION 'concurrent result mismatch'; END IF; END $$; }
step "commit_retry" { COMMIT; }
step "check" {
 DO $$ DECLARE result jsonb; BEGIN
   IF (SELECT count(*) FROM public.internal_work_records WHERE organization_id='48000000-0000-4000-8000-000000000011') <> 1 THEN RAISE EXCEPTION 'duplicate or missing row'; END IF;
   IF (SELECT count(*) FROM public.internal_work_mutation_keys WHERE organization_id='48000000-0000-4000-8000-000000000011') <> 1 THEN RAISE EXCEPTION 'duplicate or missing key'; END IF;
   IF (SELECT count(*) FROM public.audit_events WHERE organization_id='48000000-0000-4000-8000-000000000011' AND action_type='internal_work.create') <> 1 THEN RAISE EXCEPTION 'duplicate or missing audit'; END IF;
   PERFORM set_config('request.jwt.claims', '{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"issue47-rollback-session-1"}', true);
   result := public.save_internal_work_idempotent('48000000-0000-4000-8000-000000000011', '48000000-0000-4000-8000-000000000021', '48000000-0000-4000-8000-000000000041', 'Meeting', 'meeting', '2026-10-04 01:00:00+00', '2026-10-04 02:00:00+00', 1, '');
   IF result->>'replayed' <> 'true' OR (result->>'id')::uuid <> (SELECT record_id FROM public.internal_work_mutation_keys WHERE organization_id='48000000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'lost response replay mismatch'; END IF;
 END $$;
}
# rollback releases the key; the waiting request creates one row and audit.
permutation "begin_writer" "save_writer" "begin_retry" "save_retry" "rollback_writer" "commit_retry" "check"
