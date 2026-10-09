BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) VALUES
 ('84000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','shift84-owner@example.invalid','x',now(),now(),now()),
 ('84000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','shift84-other@example.invalid','x',now(),now(),now());
INSERT INTO public.profiles(id,name) VALUES
 ('84000000-0000-0000-0000-000000000001','Shift owner fixture'),
 ('84000000-0000-0000-0000-000000000002','Shift other fixture') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.organizations(id,name) VALUES
 ('84000000-0000-0000-0000-00000000000a','Shift fixture'),
 ('84000000-0000-0000-0000-00000000000b','Other shift fixture');
INSERT INTO public.organization_members(organization_id,user_id,role) VALUES
 ('84000000-0000-0000-0000-00000000000a','84000000-0000-0000-0000-000000000001','owner'),
 ('84000000-0000-0000-0000-00000000000b','84000000-0000-0000-0000-000000000002','owner');
INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at)
 VALUES('shift84-hash','shift84-session','84000000-0000-0000-0000-000000000001',now(),now()+interval '1 hour');
INSERT INTO public.clients(id,organization_id,name) VALUES
 ('84000000-0000-0000-0000-000000000010','84000000-0000-0000-0000-00000000000a','Shift client');
INSERT INTO public.shifts(id,organization_id,client_id,start_at,end_at,google_event_id) VALUES
 ('84000000-0000-0000-0000-000000000020','84000000-0000-0000-0000-00000000000a','84000000-0000-0000-0000-000000000010',now(),now()+interval '1 hour','remote84');
INSERT INTO public.shift_segments(id,shift_id,start_at,end_at) VALUES
 ('84000000-0000-0000-0000-000000000030','84000000-0000-0000-0000-000000000020',now(),now()+interval '1 hour');
INSERT INTO public.reports(id,client_id,helper_id,shift_id,segment_id,status) VALUES
 ('84000000-0000-0000-0000-000000000040','84000000-0000-0000-0000-000000000010','84000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000020','84000000-0000-0000-0000-000000000030','draft');
INSERT INTO public.report_shifts(report_id,shift_id,is_primary) VALUES
 ('84000000-0000-0000-0000-000000000040','84000000-0000-0000-0000-000000000020',true) ON CONFLICT DO NOTHING;
INSERT INTO public.retention_policies(organization_id,resource_type,retention_years,legal_basis)
VALUES ('84000000-0000-0000-0000-00000000000a','shift',5,'Fixture approved policy'),
 ('84000000-0000-0000-0000-00000000000a','report',5,'Fixture report policy'),
 ('84000000-0000-0000-0000-00000000000b','shift',7,'Other fixture policy');
SELECT ok(has_column_privilege('authenticated','public.retention_policies','retention_years','SELECT'),'session client may read retention years');
SELECT ok(NOT has_column_privilege('authenticated','public.retention_policies','reviewed_by','SELECT'),'reviewer identity remains private');
SELECT ok(NOT has_table_privilege('authenticated','public.retention_policies','INSERT'),'session client cannot approve policy');
SELECT ok(NOT has_table_privilege('authenticated','public.retention_policies','UPDATE'),'session client cannot change policy');
SELECT ok(NOT has_table_privilege('authenticated','public.retention_policies','DELETE'),'session client cannot delete policy');
SELECT ok(NOT has_column_privilege('anon','public.retention_policies','retention_years','SELECT'),'anonymous cannot read policy');
SELECT ok(NOT has_function_privilege('anon','public.get_deleted_shift_sync_targets(uuid,integer)','EXECUTE'),'anonymous cannot read deletion sync identifiers');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"shift84-session"}',true);
SELECT is((SELECT retention_years::integer FROM public.retention_policies WHERE organization_id='84000000-0000-0000-0000-00000000000a' AND resource_type='shift'),5,'actual session query reads policy before deletion');
SELECT is((SELECT legal_basis FROM public.retention_policies WHERE organization_id='84000000-0000-0000-0000-00000000000a' AND resource_type='shift'),'Fixture approved policy','session reads approved basis');
SELECT is((SELECT count(*)::integer FROM public.retention_policies WHERE organization_id='84000000-0000-0000-0000-00000000000b' AND resource_type='shift'),0,'policy read cannot cross tenant boundary');
SELECT is((SELECT count(*)::integer FROM public.retention_policies WHERE resource_type='report'),0,'unneeded resource policies are not exposed');
SELECT throws_ok($$ SELECT reviewed_by FROM public.retention_policies $$,'42501','permission denied for table retention_policies','reviewer data cannot be read');
SELECT is(public.soft_delete_shifts_atomic('84000000-0000-0000-0000-00000000000a',ARRAY['84000000-0000-0000-0000-000000000020']::uuid[],'Test deletion',now()+make_interval(years=>(SELECT retention_years FROM public.retention_policies WHERE organization_id='84000000-0000-0000-0000-00000000000a' AND resource_type='shift')),'pending_delete'),1,'local deletion succeeds without Google connection');
SELECT is((SELECT count(*)::integer FROM public.shifts WHERE id='84000000-0000-0000-0000-000000000020'),0,'normal shift RLS hides deleted shifts');
SELECT is(jsonb_array_length(public.get_deleted_shift_sync_targets('84000000-0000-0000-0000-00000000000a',20)),1,'authorized repair can retrieve pending remote deletion');
SELECT is(public.get_deleted_shift_sync_targets('84000000-0000-0000-0000-00000000000a',20)->0->>'google_event_id','remote84','remote event identifier retained');
SELECT ok(NOT (public.get_deleted_shift_sync_targets('84000000-0000-0000-0000-00000000000a',20)->0 ? 'title'),'repair RPC omits shift content');
SELECT throws_ok($$ SELECT public.get_deleted_shift_sync_targets('84000000-0000-0000-0000-00000000000b',20) $$,'P0001','shift_sync_permission_required','repair cannot cross tenant boundary');
SELECT lives_ok($$ SELECT public.mark_shift_google_sync('84000000-0000-0000-0000-000000000020','failed',NULL,false,'Google delete failed') $$,'failure is recorded on hidden deleted shift');
SELECT is(jsonb_array_length(public.get_deleted_shift_sync_targets('84000000-0000-0000-0000-00000000000a',20)),1,'failed deletion remains repairable');
SELECT lives_ok($$ SELECT public.mark_shift_google_sync('84000000-0000-0000-0000-000000000020','synced',NULL,true,NULL) $$,'successful repair clears remote identifier');
SELECT is(jsonb_array_length(public.get_deleted_shift_sync_targets('84000000-0000-0000-0000-00000000000a',20)),0,'completed remote deletions leave repair queue');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM public.shifts WHERE id='84000000-0000-0000-0000-000000000020' AND deleted_at IS NOT NULL AND retention_until IS NOT NULL),'shift body and retention deadline remain');
SELECT ok(EXISTS(SELECT 1 FROM public.shift_segments WHERE id='84000000-0000-0000-0000-000000000030'),'segment remains');
SELECT ok(EXISTS(SELECT 1 FROM public.reports WHERE id='84000000-0000-0000-0000-000000000040' AND shift_id='84000000-0000-0000-0000-000000000020' AND segment_id='84000000-0000-0000-0000-000000000030'),'report references remain');
SELECT ok(EXISTS(SELECT 1 FROM public.report_shifts WHERE report_id='84000000-0000-0000-0000-000000000040' AND shift_id='84000000-0000-0000-0000-000000000020'),'report shift link remains');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"revoked"}',true);
SELECT throws_ok($$ SELECT public.get_deleted_shift_sync_targets('84000000-0000-0000-0000-00000000000a',20) $$,'P0001','authentication_required','inactive session cannot retrieve pending deletions');
SELECT is((SELECT count(*)::integer FROM public.retention_policies),0,'inactive session cannot read policy');
RESET ROLE;
INSERT INTO public.organization_members(organization_id,user_id,role) VALUES
 ('84000000-0000-0000-0000-00000000000a','84000000-0000-0000-0000-000000000002','member');
INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at)
 VALUES('shift84-other-hash','shift84-other-session','84000000-0000-0000-0000-000000000002',now(),now()+interval '1 hour');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated","session_id":"shift84-other-session"}',true);
SELECT is((SELECT count(*)::integer FROM public.retention_policies WHERE organization_id='84000000-0000-0000-0000-00000000000a'),0,'member without shift deletion permission cannot read policy');
RESET ROLE;
INSERT INTO public.organization_roles(id,organization_id,name,permissions)
 VALUES('84000000-0000-0000-0000-000000000050','84000000-0000-0000-0000-00000000000a','Shift deleter','{"shifts":{"delete":"all"}}');
INSERT INTO public.organization_member_roles(organization_id,user_id,role_id)
 VALUES('84000000-0000-0000-0000-00000000000a','84000000-0000-0000-0000-000000000002','84000000-0000-0000-0000-000000000050');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.retention_policies WHERE organization_id='84000000-0000-0000-0000-00000000000a'),1,'authorized non-owner can read shift policy');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{"shifts":{"delete":"assigned"}}' WHERE id='84000000-0000-0000-0000-000000000050';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.retention_policies WHERE organization_id='84000000-0000-0000-0000-00000000000a'),0,'assigned-only scope does not gain all-scope policy access');
RESET ROLE;
UPDATE public.organizations SET deleted_at=now() WHERE id='84000000-0000-0000-0000-00000000000b';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.retention_policies WHERE organization_id='84000000-0000-0000-0000-00000000000b'),0,'deleted organization policy is hidden');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
