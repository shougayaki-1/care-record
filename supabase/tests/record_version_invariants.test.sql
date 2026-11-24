BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES ('c2000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','version-contract@example.invalid','synthetic',now(),now(),now());
INSERT INTO public.profiles(id,name) VALUES ('c2000000-0000-4000-8000-000000000001','Synthetic version actor') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.organizations(id,name) VALUES ('c2000000-0000-4000-8000-000000000010','Synthetic version organization');
INSERT INTO public.organization_members(organization_id,user_id,role)
VALUES ('c2000000-0000-4000-8000-000000000010','c2000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.clients(id,organization_id,name)
VALUES ('c2000000-0000-4000-8000-000000000020','c2000000-0000-4000-8000-000000000010','Synthetic version client');
INSERT INTO public.staffs(id,organization_id,user_id,name)
VALUES ('c2000000-0000-4000-8000-000000000030','c2000000-0000-4000-8000-000000000010','c2000000-0000-4000-8000-000000000001','Synthetic version staff');
INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at)
VALUES ('ci-version-hash','ci-version-session','c2000000-0000-4000-8000-000000000001',now(),now()+interval '1 hour');

CREATE FUNCTION pg_temp.save_version(target uuid, expected bigint, key_suffix integer, reason text DEFAULT NULL, body text DEFAULT 'initial')
RETURNS jsonb LANGUAGE sql AS $fn$
 SELECT public.save_report_versioned(
  p_organization_id=>'c2000000-0000-4000-8000-000000000010', p_report_id=>target,
  p_client_id=>'c2000000-0000-4000-8000-000000000020',
  p_shift_id=>NULL,p_segment_id=>NULL,
  p_start_at=>'2026-10-01 01:00:00+00',p_end_at=>'2026-10-01 02:00:00+00',
  p_status=>CASE WHEN target IS NULL THEN 'pending' WHEN reason IS NOT NULL THEN 'remanded' ELSE 'approved' END,
  p_values=>jsonb_build_object('note',body),p_expected_version=>expected,
  p_idempotency_key=>('c2000000-0000-4000-8000-'||lpad(key_suffix::text,12,'0'))::uuid,
  p_session_id=>'ci-version-session',p_correction_reason=>reason,
  p_actual_staffs=>'[{"staff_id":"c2000000-0000-4000-8000-000000000030"}]');
$fn$;
GRANT EXECUTE ON FUNCTION pg_temp.save_version(uuid,bigint,integer,text,text) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"ci-version-session"}',true);
SELECT set_config('ci.version.created',pg_temp.save_version(NULL,0,100)::text,true);
SELECT set_config('ci.version.report',current_setting('ci.version.created')::jsonb->>'recordId',true);
SELECT set_config('ci.version.first',pg_temp.save_version(current_setting('ci.version.report')::uuid,
 (current_setting('ci.version.created')::jsonb->>'version')::bigint,110)::text,true);
SELECT set_config('ci.version.prior',current_setting('ci.version.first')::jsonb->>'revisionId',true);
RESET ROLE;
SELECT set_config('ci.version.snapshot',(SELECT to_jsonb(v)::text FROM public.record_versions v WHERE id=current_setting('ci.version.prior')::uuid),true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT status FROM public.reports WHERE id=current_setting('ci.version.report')::uuid),'approved','fixture exercises an approved report');
SELECT is(pg_temp.save_version(NULL,0,100)->>'recordId',current_setting('ci.version.report'),'same key replays the same approved record');
SELECT throws_ok($q$ SELECT pg_temp.save_version(NULL,0,100,NULL,'different') $q$,'P0001','idempotency_key_reused','same key cannot change the saved payload');
SELECT throws_ok($q$ SELECT pg_temp.save_version(current_setting('ci.version.report')::uuid,0,101,'reason','changed') $q$,'CR409',NULL,'stale version is rejected');
SELECT throws_ok($q$ SELECT pg_temp.save_version(current_setting('ci.version.report')::uuid,(current_setting('ci.version.first')::jsonb->>'version')::bigint,102,NULL,'changed') $q$,'P0001','correction_reason_required','approved content requires a correction reason');
SELECT set_config('ci.version.corrected',pg_temp.save_version(current_setting('ci.version.report')::uuid,
 (current_setting('ci.version.first')::jsonb->>'version')::bigint,103,'  Synthetic correction reason  ','corrected')::text,true);
RESET ROLE;
SELECT ok((current_setting('ci.version.corrected')::jsonb->>'version')::bigint > (current_setting('ci.version.first')::jsonb->>'version')::bigint,'correction creates a newer version');
SELECT is((SELECT to_jsonb(v) FROM public.record_versions v WHERE id=current_setting('ci.version.prior')::uuid),current_setting('ci.version.snapshot')::jsonb,'old snapshot and hash remain byte-for-byte unchanged');
SELECT ok(EXISTS(SELECT 1 FROM public.report_corrections WHERE report_id=current_setting('ci.version.report')::uuid
 AND prior_revision_id=current_setting('ci.version.prior')::uuid
 AND corrected_revision_id=(current_setting('ci.version.corrected')::jsonb->>'revisionId')::uuid
 AND reason='Synthetic correction reason' AND corrected_by='c2000000-0000-4000-8000-000000000001'),'correction links old/new revisions, actor and trimmed reason');
SELECT ok((SELECT snapshot_hash IS NOT NULL AND snapshot_hash <> current_setting('ci.version.snapshot')::jsonb->>'snapshot_hash'
 FROM public.record_versions WHERE id=(current_setting('ci.version.corrected')::jsonb->>'revisionId')::uuid),'new content has a different non-null hash');
SELECT is((SELECT previous_hash FROM public.record_versions WHERE resource_id=current_setting('ci.version.report')::uuid ORDER BY version_number DESC LIMIT 1),
 (SELECT snapshot_hash FROM public.record_versions WHERE resource_id=current_setting('ci.version.report')::uuid ORDER BY version_number DESC LIMIT 1 OFFSET 1),
 'new revision links to the immediately preceding snapshot hash');
RESET ROLE;
SELECT throws_ok($q$ UPDATE public.record_versions SET snapshot='{}' WHERE id=current_setting('ci.version.prior')::uuid $q$,
 'P0001','record_versions_are_append_only','even a privileged direct update cannot rewrite a prior revision');

SELECT set_config('ci.version.counts',(SELECT jsonb_build_object(
 'report',(SELECT to_jsonb(r) FROM public.reports r WHERE id=current_setting('ci.version.report')::uuid),
 'versions',(SELECT count(*) FROM public.record_versions WHERE resource_id=current_setting('ci.version.report')::uuid),
 'keys',(SELECT count(*) FROM public.report_mutation_keys WHERE organization_id='c2000000-0000-4000-8000-000000000010'),
 'corrections',(SELECT count(*) FROM public.report_corrections WHERE report_id=current_setting('ci.version.report')::uuid))::text),true);
CREATE FUNCTION pg_temp.fail_version_audit() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'ci_version_audit_unavailable'; END $fn$;
CREATE TRIGGER ci_version_fail_audit BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_version_audit();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$ SELECT pg_temp.save_version(current_setting('ci.version.report')::uuid,
 (current_setting('ci.version.corrected')::jsonb->>'version')::bigint,104,'Another correction','must roll back') $q$,
 'P0001','ci_version_audit_unavailable','audit failure aborts the versioned save');
RESET ROLE;
SELECT is((SELECT jsonb_build_object(
 'report',(SELECT to_jsonb(r) FROM public.reports r WHERE id=current_setting('ci.version.report')::uuid),
 'versions',(SELECT count(*) FROM public.record_versions WHERE resource_id=current_setting('ci.version.report')::uuid),
 'keys',(SELECT count(*) FROM public.report_mutation_keys WHERE organization_id='c2000000-0000-4000-8000-000000000010'),
 'corrections',(SELECT count(*) FROM public.report_corrections WHERE report_id=current_setting('ci.version.report')::uuid))),
 current_setting('ci.version.counts')::jsonb,'audit failure rolls back report, versions, idempotency key and correction together');
SELECT * FROM finish();
ROLLBACK;
