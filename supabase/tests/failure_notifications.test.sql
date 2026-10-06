BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

SELECT ok(NOT has_table_privilege('authenticated','private.google_sync_failure_episodes','SELECT'),'episode bookkeeping is not client data');
SELECT ok(NOT has_table_privilege('service_role','private.google_sync_failure_episodes','UPDATE'),'backend cannot forge sync episodes');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.google_sync_failure_episodes'::regclass),'private table has RLS');
SELECT ok(NOT has_function_privilege('authenticated','public.get_backup_notification_recipients(uuid)','EXECUTE'),'browser cannot enumerate recipients');
SELECT ok(NOT has_function_privilege('anon','public.get_backup_notification_recipients(uuid)','EXECUTE'),'anonymous cannot enumerate recipients');
SELECT ok(has_function_privilege('service_role','public.get_backup_notification_recipients(uuid)','EXECUTE'),'existing backup backend can select recipients');
SELECT ok(NOT has_function_privilege('authenticated','private.notify_full_backup_failure(text)','EXECUTE'),'browser cannot broadcast backup failures');
SELECT ok(NOT has_function_privilege('service_role','private.notify_full_backup_failure(text)','EXECUTE'),'full backup adapter is direct DB only');

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
SELECT ('62000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','failure62-'||i||'@example.invalid','x',now(),now(),now() FROM generate_series(1,9) i;
INSERT INTO public.profiles(id,name)
SELECT ('62000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Failure fixture' FROM generate_series(1,9) i ON CONFLICT DO NOTHING;
INSERT INTO public.organizations(id,name) VALUES
 ('62000000-0000-4000-8000-000000000010','Failure org'),('62000000-0000-4000-8000-000000000011','Other org');
INSERT INTO public.organization_members(organization_id,user_id,role)
SELECT '62000000-0000-4000-8000-000000000010',('62000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 CASE WHEN i IN(1,6,7,8) THEN 'owner' ELSE 'member' END FROM generate_series(1,9) i WHERE i<>5;
INSERT INTO public.organization_members(organization_id,user_id,role) VALUES
 ('62000000-0000-4000-8000-000000000011','62000000-0000-4000-8000-000000000005','owner');
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='62000000-0000-4000-8000-000000000006';
UPDATE public.profiles SET deleted_at=now() WHERE id='62000000-0000-4000-8000-000000000007';
UPDATE public.profiles SET role='super_admin' WHERE id='62000000-0000-4000-8000-000000000008';
INSERT INTO public.organization_roles(id,organization_id,name,permissions) VALUES
 ('62000000-0000-4000-8000-000000000021','62000000-0000-4000-8000-000000000010','Backup viewer','{"management":{"backupStatus":true}}'),
 ('62000000-0000-4000-8000-000000000022','62000000-0000-4000-8000-000000000010','Sync manager','{"shifts":{"view":"all","edit":"all"}}'),
 ('62000000-0000-4000-8000-000000000023','62000000-0000-4000-8000-000000000010','Edit without view','{"shifts":{"view":"none","edit":"all"}}');
INSERT INTO public.organization_member_roles(organization_id,user_id,role_id) VALUES
 ('62000000-0000-4000-8000-000000000010','62000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000021'),
 ('62000000-0000-4000-8000-000000000010','62000000-0000-4000-8000-000000000003','62000000-0000-4000-8000-000000000022'),
 ('62000000-0000-4000-8000-000000000010','62000000-0000-4000-8000-000000000009','62000000-0000-4000-8000-000000000023');
INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at) VALUES
 ('failure62-hash','failure62-session','62000000-0000-4000-8000-000000000001',now(),now()+interval '1 hour');
INSERT INTO public.clients(id,organization_id,name) VALUES
 ('62000000-0000-4000-8000-000000000030','62000000-0000-4000-8000-000000000010','PHI fixture not for notifications');
INSERT INTO public.shifts(id,organization_id,client_id,start_at,end_at,title) VALUES
 ('62000000-0000-4000-8000-000000000040','62000000-0000-4000-8000-000000000010','62000000-0000-4000-8000-000000000030',now(),now()+interval '1 hour','PHI fixture title');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"failure62-session"}',true);
SELECT lives_ok($$ SELECT public.mark_shift_google_sync('62000000-0000-4000-8000-000000000040','failed',NULL,false,'external secret fixture') $$,'actual authorized sync status path emits failure notification');
SELECT throws_ok($$ SELECT public.mark_shift_google_sync('62000000-0000-4000-8000-000000000040','invalid',NULL,false,NULL) $$,'P0001','invalid sync status','invalid status cannot generate notifications');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='google_calendar.sync_failed'),2::bigint,'only owner and permitted sync manager receive failure');
SELECT ok(EXISTS(SELECT 1 FROM public.notifications WHERE event_type='google_calendar.sync_failed' AND user_id='62000000-0000-4000-8000-000000000003'),'custom role rather than owner-only');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id IN('62000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000004','62000000-0000-4000-8000-000000000005','62000000-0000-4000-8000-000000000006','62000000-0000-4000-8000-000000000007','62000000-0000-4000-8000-000000000008','62000000-0000-4000-8000-000000000009')),'no irrelevant, cross-tenant, disabled, super-admin or inaccessible recipient');
SELECT ok((SELECT bool_and(category='warning' AND link_url='/app/shifts/manage' AND content='未同期のシフトを確認してください。' AND title='Googleカレンダーの同期に失敗しました') FROM public.notifications),'fixed PHI-free template and authorized destination');
UPDATE public.notifications SET is_read=true WHERE event_type='google_calendar.sync_failed';
DO $$ BEGIN FOR i IN 1..10 LOOP
 UPDATE public.shifts SET google_sync_status='pending_upsert' WHERE id='62000000-0000-4000-8000-000000000040';
 UPDATE public.shifts SET google_sync_status='failed' WHERE id='62000000-0000-4000-8000-000000000040';
END LOOP; END $$;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='google_calendar.sync_failed'),2::bigint,'ten retries with pending status keep one notification per recipient');
SELECT ok((SELECT bool_and(is_read) FROM public.notifications WHERE event_type='google_calendar.sync_failed'),'retry does not reset read state');
UPDATE public.shifts SET google_sync_status='synced' WHERE id='62000000-0000-4000-8000-000000000040';
SELECT is((SELECT count(*) FROM public.notifications),2::bigint,'success does not create a notification');
UPDATE public.shifts SET google_sync_status='failed' WHERE id='62000000-0000-4000-8000-000000000040';
SELECT is((SELECT count(DISTINCT dedupe_key) FROM public.notifications),2::bigint,'new failure after recovery creates another episode');
UPDATE public.shifts SET deleted_at=now(),google_sync_status='pending_delete' WHERE id='62000000-0000-4000-8000-000000000040';
UPDATE public.shifts SET google_sync_status='failed' WHERE id='62000000-0000-4000-8000-000000000040';
SELECT is((SELECT count(*) FROM public.notifications),4::bigint,'deleted shift retries retain the same failure episode');
UPDATE public.shifts SET google_sync_status='synced' WHERE id='62000000-0000-4000-8000-000000000040';
ALTER TABLE public.notifications ADD CONSTRAINT fixture_notification_outage CHECK(event_type IS DISTINCT FROM 'google_calendar.sync_failed') NOT VALID;
SELECT lives_ok($$ UPDATE public.shifts SET google_sync_status='failed',google_sync_error='safe failure' WHERE id='62000000-0000-4000-8000-000000000040' $$,'notification outage does not roll back sync status');
SELECT is((SELECT google_sync_status FROM public.shifts WHERE id='62000000-0000-4000-8000-000000000040'),'failed','authoritative failure persists');
SELECT is((SELECT google_sync_error FROM public.shifts WHERE id='62000000-0000-4000-8000-000000000040'),'safe failure','original diagnostic persists');
ALTER TABLE public.notifications DROP CONSTRAINT fixture_notification_outage;
UPDATE public.shifts SET google_sync_status='failed' WHERE id='62000000-0000-4000-8000-000000000040';
SELECT is((SELECT count(*) FROM public.notifications),6::bigint,'delivery resumes for same persisted episode after outage');
UPDATE public.organization_roles SET permissions='{"shifts":{"view":"all","edit":"assigned"}}' WHERE id='62000000-0000-4000-8000-000000000022';
UPDATE public.shifts SET google_sync_status='synced' WHERE id='62000000-0000-4000-8000-000000000040';
UPDATE public.shifts SET google_sync_status='failed' WHERE id='62000000-0000-4000-8000-000000000040';
SELECT is((SELECT count(*) FROM public.notifications),7::bigint,'assigned scope does not receive organization-wide failures');

SET LOCAL ROLE service_role;
SELECT is((SELECT count(*) FROM public.get_backup_notification_recipients('62000000-0000-4000-8000-000000000010')),2::bigint,'backup recipients use backupStatus independently of sync permission');
SELECT lives_ok($$ SELECT public.create_notification('62000000-0000-4000-8000-000000000002','backup.failed','62000000-0000-4000-8000-000000000010',NULL,NULL,'62000000-0000-4000-8000-000000000050') $$,'custom backup viewer receives failure');
SELECT is(public.create_notification('62000000-0000-4000-8000-000000000002','backup.failed','62000000-0000-4000-8000-000000000010',NULL,NULL,'62000000-0000-4000-8000-000000000050'),NULL::uuid,'same backup occurrence is deduplicated');
SELECT lives_ok($$ SELECT public.create_notification('62000000-0000-4000-8000-000000000002','backup.failed','62000000-0000-4000-8000-000000000010',NULL,NULL,'62000000-0000-4000-8000-000000000051') $$,'next scheduled run can notify again');
SELECT throws_ok($$ SELECT public.create_notification('62000000-0000-4000-8000-000000000005','backup.failed','62000000-0000-4000-8000-000000000010') $$,'42501','notification_recipient_permission_required','backup never crosses organization');
SELECT throws_ok($$ SELECT public.create_notification('62000000-0000-4000-8000-000000000003','backup.failed','62000000-0000-4000-8000-000000000010') $$,'42501','notification_recipient_permission_required','sync permission does not imply backup permission');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{}' WHERE id='62000000-0000-4000-8000-000000000021';
SET LOCAL ROLE service_role;
SELECT throws_ok($$ SELECT public.create_notification('62000000-0000-4000-8000-000000000002','backup.failed','62000000-0000-4000-8000-000000000010') $$,'42501','notification_recipient_permission_required','delivery rechecks revoked permission');
RESET ROLE;
SELECT lives_ok($$ SELECT private.notify_full_backup_failure('123456') $$,'full backup reuses private common helper for all affected organizations');
SELECT lives_ok($$ SELECT private.notify_full_backup_failure('123456') $$,'workflow retry uses same run key');
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='backup.failed'),4::bigint,'full run creates only one notification per eligible organization recipient');
SELECT lives_ok($$ SELECT private.notify_full_backup_failure('123457') $$,'next full run is independent');
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='backup.failed'),6::bigint,'new full run notifies again');
SELECT ok((SELECT bool_and(category='warning' AND link_url='/app/backup' AND content='バックアップの状態を確認してください。') FROM public.notifications WHERE event_type='backup.failed'),'backup uses common fixed warning template');
UPDATE public.organizations SET deleted_at=now() WHERE id='62000000-0000-4000-8000-000000000011';
SELECT is((SELECT count(*) FROM public.get_backup_notification_recipients(NULL)),1::bigint,'deleted organizations are excluded');
SELECT throws_ok($$ SELECT private.notify_full_backup_failure('token or raw error') $$,'P0001','invalid_backup_run','full backup accepts only numeric GitHub run identifiers');

SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.mark_google_calendar_sync_result('62000000-0000-4000-8000-000000000010',true) $$,'repair listing failure is covered before shift processing');
SELECT lives_ok($$ SELECT public.mark_google_calendar_sync_result('62000000-0000-4000-8000-000000000010',true) $$,'listing retry reuses occurrence');
SELECT throws_ok($$ SELECT public.mark_google_calendar_sync_result('62000000-0000-4000-8000-000000000011',true) $$,'P0001','shift_sync_permission_required','cannot forge another organization listing failure');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='google_calendar.sync_failed'),8::bigint,'listing retry creates one warning for current eligible recipient');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.mark_google_calendar_sync_result('62000000-0000-4000-8000-000000000010',false) $$,'listing recovery closes episode without success notification');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='google_calendar.sync_failed'),8::bigint,'listing success does not notify');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.mark_google_calendar_sync_result('62000000-0000-4000-8000-000000000010',true) $$,'listing failure after recovery creates a new episode');
SELECT set_config('request.jwt.claims','{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"expired"}',true);
SELECT throws_ok($$ SELECT public.mark_google_calendar_sync_result('62000000-0000-4000-8000-000000000010',true) $$,'P0001','authentication_required','expired session cannot generate failure warnings');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='google_calendar.sync_failed'),9::bigint,'recovered calendar listing can notify again');

SELECT * FROM finish();
ROLLBACK;
