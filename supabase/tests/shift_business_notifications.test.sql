BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public,extensions;
SELECT no_plan();
-- Synthetic accounts: owner, two staff, disabled, banned, super-admin, member,
-- and an unrelated tenant's owner. No production data is involved.
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
SELECT ('61000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','shift-'||i||'@example.invalid','x',now(),now(),now() FROM generate_series(1,8) i;
INSERT INTO public.profiles(id,name) SELECT id,'Synthetic staff' FROM auth.users WHERE id::text LIKE '61000000-%' ON CONFLICT(id) DO NOTHING;
INSERT INTO public.organizations(id,name) VALUES ('61000000-0000-4000-8000-000000000010','Shift fixture'),('61000000-0000-4000-8000-000000000020','Other fixture');
INSERT INTO public.organization_members(organization_id,user_id,role)
SELECT '61000000-0000-4000-8000-000000000010',('61000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 CASE WHEN i=1 THEN 'owner' ELSE 'member' END FROM generate_series(1,7) i;
INSERT INTO public.organization_members(organization_id,user_id,role) VALUES ('61000000-0000-4000-8000-000000000020','61000000-0000-4000-8000-000000000008','owner');
INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at)
SELECT 'shift-hash-'||i,'shift-session-'||i,('61000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,now(),now()+interval '1 hour' FROM generate_series(1,8) i;
INSERT INTO public.clients(id,organization_id,name) VALUES ('61000000-0000-4000-8000-000000000030','61000000-0000-4000-8000-000000000010','PHI synthetic client');
INSERT INTO public.staffs(id,organization_id,user_id,name)
SELECT ('61000000-0000-4000-8000-'||lpad((40+i)::text,12,'0'))::uuid,'61000000-0000-4000-8000-000000000010',
 ('61000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Synthetic staff' FROM generate_series(1,8) i;
INSERT INTO public.staffs(id,organization_id,name) VALUES ('61000000-0000-4000-8000-000000000049','61000000-0000-4000-8000-000000000010','Unlinked staff');
UPDATE public.profiles SET deleted_at=now() WHERE id='61000000-0000-4000-8000-000000000004';
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='61000000-0000-4000-8000-000000000005';
UPDATE public.profiles SET role='super_admin' WHERE id='61000000-0000-4000-8000-000000000006';
UPDATE public.staffs SET deleted_at=now() WHERE id='61000000-0000-4000-8000-000000000047';

CREATE FUNCTION pg_temp.segments(p_staff_ids uuid[],p_start timestamptz DEFAULT '2026-10-10 00:00+00',p_end timestamptz DEFAULT '2026-10-10 01:00+00') RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_object('start_at',p_start,'end_at',p_end,'staffs',COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id',id)) FROM unnest(p_staff_ids) id),'[]'::jsonb))) $$;
CREATE FUNCTION pg_temp.flush() RETURNS void LANGUAGE plpgsql AS $$
BEGIN SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED; END $$;
CREATE FUNCTION pg_temp.create_shift(p_staff_ids uuid[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE sid uuid;
BEGIN
 sid:=public.create_shift_with_segments_atomic('61000000-0000-4000-8000-000000000010',jsonb_build_object(
 'client_id','61000000-0000-4000-8000-000000000030','title','PHI synthetic shift','start_at','2026-10-10 00:00+00',
 'end_at','2026-10-10 01:00+00','segments',pg_temp.segments(p_staff_ids)));
 PERFORM pg_temp.flush(); RETURN sid;
END $$;
CREATE FUNCTION pg_temp.edit(p_update jsonb,p_segments jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.update_shift_with_segments_atomic('61000000-0000-4000-8000-000000000010',current_setting('shift_fixture.id')::uuid,p_update,p_segments);
 PERFORM pg_temp.flush();
END $$;
CREATE FUNCTION pg_temp.change(p_start timestamptz DEFAULT NULL,p_status text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE public.shifts SET start_at=COALESCE(p_start,start_at),status=COALESCE(p_status,status),cancel_reason='PHI synthetic reason'
 WHERE id=current_setting('shift_fixture.id')::uuid;
 PERFORM pg_temp.flush();
END $$;

GRANT EXECUTE ON FUNCTION pg_temp.segments(uuid[],timestamptz,timestamptz),pg_temp.flush(),pg_temp.create_shift(uuid[]),pg_temp.edit(jsonb,jsonb),pg_temp.change(timestamptz,text) TO authenticated;

SELECT ok(NOT has_table_privilege('authenticated','private.shift_notification_state','SELECT'),'comparison state is not browser-readable');
SELECT ok(NOT has_table_privilege('service_role','private.shift_notification_state','UPDATE'),'backend cannot forge comparison state');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.shift_notification_state'::regclass),'private state has RLS');
SELECT ok(NOT has_function_privilege('authenticated','private.flush_shift_notifications()','EXECUTE'),'browser cannot generate arbitrary shift notifications');
SELECT ok(NOT has_function_privilege('anon','public.update_shift_with_segments_atomic(uuid,uuid,jsonb,jsonb)','EXECUTE'),'anonymous cannot edit shifts');
SELECT ok(has_function_privilege('authenticated','public.update_shift_with_segments_atomic(uuid,uuid,jsonb,jsonb)','EXECUTE'),'session RPC has explicit execute grant');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"shift-session-1"}',true);
SELECT set_config('shift_fixture.id',pg_temp.create_shift(ARRAY[
 '61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000042',
 '61000000-0000-4000-8000-000000000044','61000000-0000-4000-8000-000000000045',
 '61000000-0000-4000-8000-000000000046','61000000-0000-4000-8000-000000000048',
 '61000000-0000-4000-8000-000000000049']::uuid[])::text,true);
RESET ROLE;
SELECT results_eq($q$ SELECT user_id::text FROM public.notifications WHERE event_type='shift.assigned' $q$,
 ARRAY['61000000-0000-4000-8000-000000000002'],'new staff notified once; self, foreign tenant, disabled, banned, super-admin and unlinked staff excluded');
SELECT is((SELECT category FROM public.notifications WHERE event_type='shift.assigned'),'info','new assignment is informational');
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.time_changed'),0::bigint,'initial creation does not produce a time change');

SET LOCAL ROLE authenticated;
SELECT lives_ok($q$ SELECT pg_temp.edit('{}',pg_temp.segments(ARRAY[
 '61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000042',
 '61000000-0000-4000-8000-000000000044','61000000-0000-4000-8000-000000000045',
 '61000000-0000-4000-8000-000000000046','61000000-0000-4000-8000-000000000048',
 '61000000-0000-4000-8000-000000000049']::uuid[])) $q$,'recreating the same segment and staff is a no-op');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),1::bigint,'no transient unassigned or duplicate assigned notification');

SET LOCAL ROLE authenticated;
SELECT lives_ok($q$ SELECT pg_temp.edit('{}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000043']::uuid[])) $q$,'staff replacement succeeds');
SELECT lives_ok($q$ SELECT pg_temp.edit('{}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000043']::uuid[])) $q$,'replacement retry succeeds');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.unassigned' AND user_id='61000000-0000-4000-8000-000000000002'),1::bigint,'removed staff notified exactly once across retries');
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.assigned' AND user_id='61000000-0000-4000-8000-000000000003'),1::bigint,'added staff notified exactly once across retries');
SELECT is((SELECT category FROM public.notifications WHERE event_type='shift.unassigned'),'action_required','unassignment is actionable');

SET LOCAL ROLE authenticated;
SELECT pg_temp.change('2026-10-10 00:10+00');
SELECT pg_temp.change('2026-10-10 00:10+00');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.time_changed'),1::bigint,'only a real start-time change notifies current staff once');
SET LOCAL ROLE authenticated;
SELECT pg_temp.change('2026-10-10 00:20+00');
SELECT pg_temp.change(NULL,'cancelled');
SELECT pg_temp.change(NULL,'cancelled');
SELECT pg_temp.change(NULL,'published');
SELECT pg_temp.change(NULL,'published');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.time_changed'),2::bigint,'a later different time is a new occurrence');
SELECT is((SELECT count(DISTINCT dedupe_key) FROM public.notifications WHERE event_type='shift.time_changed'),2::bigint,'real later changes have distinct occurrence keys');
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.cancelled'),1::bigint,'cancel retry does not duplicate');
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.reopened'),1::bigint,'reopen retry does not duplicate');
SELECT ok((SELECT bool_and(category='action_required') FROM public.notifications WHERE event_type IN ('shift.time_changed','shift.cancelled','shift.reopened')),'time/cancel/reopen are actionable');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id='61000000-0000-4000-8000-000000000002' AND event_type IN ('shift.time_changed','shift.cancelled','shift.reopened')),'removed staff does not receive later schedule changes');

-- A segment time changes the assigned staff's working schedule even when the
-- parent envelope is unchanged. Internal roles/service labels do not.
SET LOCAL ROLE authenticated;
SELECT pg_temp.edit('{}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000043']::uuid[],'2026-10-10 00:30+00','2026-10-10 01:00+00'));
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.time_changed'),3::bigint,'staff segment time change is notified');
SELECT set_config('shift_fixture.count',(SELECT count(*)::text FROM public.notifications),true);
SET LOCAL ROLE authenticated;
UPDATE public.shifts SET title='PHI changed title',cancel_reason='PHI changed notes',is_modified=true,
 google_sync_status='synced',google_sync_error=NULL WHERE id=current_setting('shift_fixture.id')::uuid;
SELECT pg_temp.flush();
SET LOCAL TIME ZONE 'Asia/Tokyo';
SELECT pg_temp.edit('{}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000043']::uuid[],'2026-10-10 00:30+00','2026-10-10 01:00+00'));
SET LOCAL TIME ZONE 'UTC';
RESET ROLE;
SELECT is((SELECT count(*)::text FROM public.notifications),current_setting('shift_fixture.count'),'notes, metadata, Google status, timezone and identical re-save do not notify');
SELECT ok((SELECT bool_and(link_url='/app/shifts/my' AND resource_id=current_setting('shift_fixture.id')::uuid AND actor_id='61000000-0000-4000-8000-000000000001' AND dedupe_key IS NOT NULL) FROM public.notifications),'fixed existing destination and verified resource/actor/occurrence');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.notifications WHERE title LIKE '%PHI%' OR content LIKE '%PHI%' OR link_url LIKE '%PHI%'),'no client name, shift title, reason or support content leaks');

-- Recreated/duplicate segment IDs and ordering are internal details. Two
-- segment entries with the same staff/time must still represent one schedule.
SET LOCAL ROLE authenticated;
SELECT pg_temp.edit('{}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000043']::uuid[],'2026-10-10 00:30+00','2026-10-10 01:00+00') || pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000043']::uuid[],'2026-10-10 00:30+00','2026-10-10 01:00+00'));
RESET ROLE;
SELECT is((SELECT count(*)::text FROM public.notifications),current_setting('shift_fixture.count'),'multiple segments do not duplicate assigned or time notifications');

-- Notify failure must reject the entire parent/segment edit, not leave changed
-- assignments or a notification for a failed save. Flush in the same subtransaction.
CREATE FUNCTION pg_temp.fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_notification_failure'; END $$;
CREATE TRIGGER shift_synthetic_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_notification();
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$ SELECT pg_temp.edit('{"start_at":"2026-10-10 00:40+00"}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000042']::uuid[])) $q$,
 'P0001','synthetic_notification_failure','required notification failure rejects combined edit');
RESET ROLE;
SELECT is((SELECT start_at FROM public.shifts WHERE id=current_setting('shift_fixture.id')::uuid),'2026-10-10 00:20+00'::timestamptz,'failed notification rolls parent time back');
SELECT results_eq($q$ SELECT staff_id::text FROM public.shift_staffs WHERE shift_id=current_setting('shift_fixture.id')::uuid ORDER BY staff_id $q$,
 ARRAY['61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000043'],'failed notification rolls assignment set back');
SELECT is((SELECT count(*)::text FROM public.notifications),current_setting('shift_fixture.count'),'failed mutation leaves no notifications');
DROP TRIGGER shift_synthetic_failure ON public.notifications;
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$ SELECT pg_temp.edit('{"end_at":null}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000042']::uuid[])) $q$,
 '23502',NULL,'parent constraint failure after replacing segments rejects the full edit');
RESET ROLE;
SELECT results_eq($q$ SELECT staff_id::text FROM public.shift_staffs WHERE shift_id=current_setting('shift_fixture.id')::uuid ORDER BY staff_id $q$,
 ARRAY['61000000-0000-4000-8000-000000000041','61000000-0000-4000-8000-000000000043'],'failed parent mutation leaves original staff');

-- Application and DB permission boundaries remain intact.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"shift-session-2"}',true);
SELECT throws_ok($q$ SELECT pg_temp.edit('{}','[]') $q$,'P0001','shift edit permission required','staff without edit all cannot mutate through the RPC');
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000008","role":"authenticated","session_id":"shift-session-8"}',true);
SELECT throws_ok($q$ SELECT pg_temp.edit('{}','[]') $q$,'P0001','shift edit permission required','another tenant owner cannot mutate the shift');
RESET ROLE;
SELECT is((SELECT count(*)::text FROM public.notifications),current_setting('shift_fixture.count'),'permission failures leave no notifications');
-- End-time changes are detected too; same instant with a different offset is not.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"shift-session-1"}',true);
SELECT pg_temp.edit('{"end_at":"2026-10-10 01:10+00"}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000043']::uuid[],'2026-10-10 00:30+00','2026-10-10 01:00+00'));
SELECT pg_temp.edit('{"end_at":"2026-10-10 10:10+09"}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000043']::uuid[],'2026-10-10 00:30+00','2026-10-10 01:00+00'));
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.time_changed'),4::bigint,'only real end-time changes notify, not equivalent timezone representations');
SET LOCAL ROLE authenticated;
SELECT pg_temp.edit('{}',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000042']::uuid[]));
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='shift.assigned' AND user_id='61000000-0000-4000-8000-000000000002'),2::bigint,'a real reassignment is a new assigned occurrence');
SET LOCAL ROLE authenticated;
SELECT set_config('shift_fixture.generated', public.save_generated_shift_atomic(NULL,'61000000-0000-4000-8000-000000000010',
 jsonb_build_object('client_id','61000000-0000-4000-8000-000000000030','title','PHI generated title','start_at','2026-10-10 00:00+00','end_at','2026-10-10 01:00+00','status','published',
 'segments',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000043']::uuid[])))::text,true);
SELECT pg_temp.flush();
SELECT public.save_generated_shift_atomic(current_setting('shift_fixture.generated')::uuid,'61000000-0000-4000-8000-000000000010',
 jsonb_build_object('client_id','61000000-0000-4000-8000-000000000030','title','PHI generated title','start_at','2026-10-10 00:00+00','end_at','2026-10-10 01:00+00','status','published',
 'segments',pg_temp.segments(ARRAY['61000000-0000-4000-8000-000000000043']::uuid[])));
SELECT pg_temp.flush();
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE resource_id=current_setting('shift_fixture.generated')::uuid),1::bigint,'generated shifts notify on creation but not unchanged regeneration');
SELECT is((SELECT event_type FROM public.notifications WHERE resource_id=current_setting('shift_fixture.generated')::uuid),'shift.assigned','generated shift uses the shared assigned event');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"shift-session-3"}',true);
SELECT ok((SELECT count(*)>0 FROM public.notifications),'staff sees their own shift notifications');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id<>auth.uid()),'notification RLS continues to restrict recipients');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
