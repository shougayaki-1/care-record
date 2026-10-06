BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

-- All identities and text below are synthetic fixtures.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
SELECT ('60000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'workflow-' || i || '@example.invalid', 'x', now(), now(), now() FROM generate_series(1,12) i;
INSERT INTO public.profiles (id,name) SELECT id,'Workflow fixture' FROM auth.users WHERE id::text LIKE '60000000-%' ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organizations (id,name) VALUES ('60000000-0000-4000-8000-000000000010','Workflow org'),('60000000-0000-4000-8000-000000000020','Other org');
INSERT INTO public.organization_members (organization_id,user_id,role)
SELECT '60000000-0000-4000-8000-000000000010', ('60000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, CASE WHEN i=1 THEN 'owner' ELSE 'member' END FROM generate_series(1,7) i;
INSERT INTO public.organization_members (organization_id,user_id,role) VALUES ('60000000-0000-4000-8000-000000000020','60000000-0000-4000-8000-000000000008','owner');
INSERT INTO public.organization_roles (id,organization_id,name,permissions)
SELECT ('60000000-0000-4000-8000-' || lpad((100+i)::text,12,'0'))::uuid, '60000000-0000-4000-8000-000000000010', 'Workflow role ' || i,
 jsonb_build_object('records',jsonb_build_object('view','all','create','all','edit','all','approve',CASE WHEN i=3 OR i=7 THEN 'all' WHEN i IN (4,5) THEN 'assigned' ELSE 'none' END,'delete',CASE WHEN i=3 THEN 'all' ELSE 'none' END),'management',jsonb_build_object('reports',i BETWEEN 3 AND 6)) FROM generate_series(2,7) i;
INSERT INTO public.organization_member_roles (organization_id,user_id,role_id)
SELECT '60000000-0000-4000-8000-000000000010', ('60000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, ('60000000-0000-4000-8000-' || lpad((100+i)::text,12,'0'))::uuid FROM generate_series(2,7) i;
INSERT INTO public.user_session_activity (session_hash,auth_session_id,user_id,last_activity,absolute_expires_at)
SELECT 'workflow-hash-'||i,'workflow-session-'||i,('60000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,now(),now()+interval '1 hour' FROM generate_series(1,8) i;
INSERT INTO public.clients (id,organization_id,name) VALUES ('60000000-0000-4000-8000-000000000030','60000000-0000-4000-8000-000000000010','PHI fixture name');
INSERT INTO public.staffs (id,organization_id,user_id,name) VALUES ('60000000-0000-4000-8000-000000000040','60000000-0000-4000-8000-000000000010','60000000-0000-4000-8000-000000000002','Fixture staff');
INSERT INTO public.assignments (client_id,helper_id) VALUES ('60000000-0000-4000-8000-000000000030','60000000-0000-4000-8000-000000000004');

-- Coarse owner roles do not make disabled accounts eligible recipients.
INSERT INTO public.organization_members (organization_id,user_id,role)
SELECT '60000000-0000-4000-8000-000000000010', ('60000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid, 'owner' FROM generate_series(9,12) i;
UPDATE public.profiles SET deleted_at=now() WHERE id='60000000-0000-4000-8000-000000000009';
UPDATE auth.users SET deleted_at=now() WHERE id='60000000-0000-4000-8000-000000000010';
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='60000000-0000-4000-8000-000000000011';
UPDATE public.profiles SET role='super_admin' WHERE id='60000000-0000-4000-8000-000000000012';
SELECT is((SELECT count(*) FROM private.report_workflow_recipients('60000000-0000-4000-8000-000000000010')),7::bigint,'deleted, banned and super-admin accounts are excluded even with owner membership');
SELECT ok(NOT has_function_privilege('authenticated','private.report_workflow_recipients(uuid)','EXECUTE'),'browser cannot enumerate workflow recipients');

SELECT ok(NOT has_function_privilege('authenticated','private.notify_report_status()','EXECUTE'), 'browser cannot execute report notification trigger');
SELECT ok(NOT has_function_privilege('authenticated','private.notify_report_deletion_request()','EXECUTE'), 'browser cannot execute deletion notification trigger');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"workflow-session-2"}',true);
SELECT set_config('workflow.report', (public.save_report_versioned(
 p_organization_id=>'60000000-0000-4000-8000-000000000010',p_report_id=>NULL,p_client_id=>'60000000-0000-4000-8000-000000000030',p_shift_id=>NULL,p_segment_id=>NULL,
 p_start_at=>'2026-10-01 00:00:00+00',p_end_at=>'2026-10-01 01:00:00+00',p_status=>'draft',p_values=>'{}',p_expected_version=>0,p_idempotency_key=>'60000000-0000-4000-8000-000000000050')->>'recordId'),true);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE organization_id='60000000-0000-4000-8000-000000000010'),0::bigint,'draft save is not a notification');
SELECT set_config('workflow.version',(SELECT current_version::text FROM public.reports WHERE id=current_setting('workflow.report')::uuid),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"workflow-session-2"}',true);
SELECT lives_ok($q$ SELECT public.save_report_versioned(
 p_organization_id=>'60000000-0000-4000-8000-000000000010',p_report_id=>current_setting('workflow.report')::uuid,p_client_id=>'60000000-0000-4000-8000-000000000030',p_shift_id=>NULL,p_segment_id=>NULL,
 p_start_at=>'2026-10-01 00:00:00+00',p_end_at=>'2026-10-01 01:00:00+00',p_status=>'pending',p_values=>'{"note":"PHI fixture body"}',p_expected_version=>current_setting('workflow.version')::bigint,p_idempotency_key=>'60000000-0000-4000-8000-000000000051',p_actual_staffs=>'[{"staff_id":"60000000-0000-4000-8000-000000000040"}]') $q$,'versioned submission succeeds');
SELECT lives_ok($q$ SELECT public.save_report_versioned(
 p_organization_id=>'60000000-0000-4000-8000-000000000010',p_report_id=>current_setting('workflow.report')::uuid,p_client_id=>'60000000-0000-4000-8000-000000000030',p_shift_id=>NULL,p_segment_id=>NULL,
 p_start_at=>'2026-10-01 00:00:00+00',p_end_at=>'2026-10-01 01:00:00+00',p_status=>'pending',p_values=>'{"note":"PHI fixture body"}',p_expected_version=>current_setting('workflow.version')::bigint,p_idempotency_key=>'60000000-0000-4000-8000-000000000051',p_actual_staffs=>'[{"staff_id":"60000000-0000-4000-8000-000000000040"}]') $q$,'RPC replay succeeds without a second transition');
RESET ROLE;
SELECT results_eq($q$ SELECT user_id::text FROM public.notifications WHERE event_type='report.submitted' ORDER BY user_id $q$,
 ARRAY['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000004'],'only real all/assigned approvers under the Action/RPC contract receive submission; no cross-org or coarse-role recipients');
SELECT ok((SELECT bool_and(dedupe_key IS NOT NULL AND resource_id=current_setting('workflow.report')::uuid) FROM public.notifications WHERE event_type='report.submitted'),'occurrence keys and verified resources are present');
SELECT ok((SELECT bool_and(link_url LIKE '/app/record/60000000-0000-4000-8000-000000000030?reportId=%') FROM public.notifications WHERE event_type='report.submitted'),'report notifications reach the existing detail page');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"workflow-session-5"}',true);
SELECT throws_ok($q$ SELECT public.transition_reports_authorized('60000000-0000-4000-8000-000000000010',ARRAY[current_setting('workflow.report')::uuid],'approve') $q$,'22023','invalid_or_inaccessible_reports','unassigned approver cannot act through a notification link');
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"workflow-session-4"}',true);
SELECT lives_ok($q$ SELECT public.transition_reports_authorized('60000000-0000-4000-8000-000000000010',ARRAY[current_setting('workflow.report')::uuid],'approve') $q$,'assigned approver can approve');
SELECT lives_ok($q$ SELECT public.transition_reports_authorized('60000000-0000-4000-8000-000000000010',ARRAY[current_setting('workflow.report')::uuid],'approve') $q$,'repeat approval is a no-op notification');
SELECT lives_ok($q$ SELECT public.transition_reports_authorized('60000000-0000-4000-8000-000000000010',ARRAY[current_setting('workflow.report')::uuid],'remand') $q$,'approved report can be remanded');
RESET ROLE;
SELECT results_eq($q$ SELECT user_id::text FROM public.notifications WHERE event_type='report.approved' $q$,ARRAY['60000000-0000-4000-8000-000000000002'],'approval result goes once to the submitter, not the approver');
SELECT results_eq($q$ SELECT user_id::text FROM public.notifications WHERE event_type='report.remanded' $q$,ARRAY['60000000-0000-4000-8000-000000000002'],'remand result goes to the submitter');
-- A later real submission has a new occurrence even within one transaction.
UPDATE public.reports SET status='pending' WHERE id=current_setting('workflow.report')::uuid;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='report.submitted'),6::bigint,'resubmission creates a separate legitimate occurrence');
SELECT is((SELECT count(DISTINCT dedupe_key) FROM public.notifications WHERE event_type='report.submitted'),2::bigint,'one occurrence UUID is shared by recipients but different across transitions');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"workflow-session-2"}',true);
SELECT set_config('workflow.request',public.request_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.report')::uuid,'PHI fixture deletion reason')::text,true);
SELECT is(public.request_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.report')::uuid,'PHI fixture deletion reason')::text,current_setting('workflow.request'),'double submission reuses the open request');
SELECT is((SELECT count(*) FROM public.deletion_requests),1::bigint,'applicant sees only their own request');
RESET ROLE;
SELECT results_eq($q$ SELECT user_id::text FROM public.notifications WHERE event_type='deletion_request.created' ORDER BY user_id $q$,
 ARRAY['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000006'],'only users authorized to decide (including rejection-only managers) receive deletion requests');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000006","role":"authenticated","session_id":"workflow-session-6"}',true);
SELECT lives_ok($q$ SELECT public.decide_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.request')::uuid,'reject') $q$,'management-only recipient can reject under current RPC');
SELECT throws_ok($q$ SELECT public.decide_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.request')::uuid,'reject') $q$,'P0001','already_decided','decision replay does not generate another result');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='deletion_request.rejected' AND user_id='60000000-0000-4000-8000-000000000002'),1::bigint,'rejection notifies the applicant once');
SELECT is((SELECT category FROM public.notifications WHERE event_type='deletion_request.rejected'),'action_required','rejection is actionable');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"workflow-session-2"}',true);
SELECT set_config('workflow.request2',public.request_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.report')::uuid,'PHI fixture deletion reason')::text,true);
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"workflow-session-3"}',true);
SELECT lives_ok($q$ SELECT public.decide_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.request2')::uuid,'approve') $q$,'delete-all manager can approve');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE event_type='deletion_request.approved' AND user_id='60000000-0000-4000-8000-000000000002'),1::bigint,'completed deletion generates an approval notification');
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.reports WHERE id=current_setting('workflow.report')::uuid),'deletion and notification are committed together');
SELECT ok((SELECT bool_and(link_url LIKE '/app/reports/deletion-requests?requestId=%') FROM public.notifications WHERE resource_type='deletion_request'),'deletion links target a specific request');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.notifications WHERE content LIKE '%PHI%' OR title LIKE '%PHI%' OR link_url LIKE '%PHI%'),'PHI never enters title/content/link/key');

-- Notification failures roll back the enclosing business mutation, with a fixed server log.
CREATE FUNCTION pg_temp.fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_notification_failure'; END $$;
CREATE TRIGGER workflow_synthetic_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_notification();
UPDATE public.reports SET deleted_at=NULL,status='draft' WHERE id=current_setting('workflow.report')::uuid;
SELECT throws_ok($q$ UPDATE public.reports SET status='pending' WHERE id=current_setting('workflow.report')::uuid $q$,'P0001','synthetic_notification_failure','required notification failure rejects a status mutation');
SELECT is((SELECT status FROM public.reports WHERE id=current_setting('workflow.report')::uuid),'draft','report status rolled back on notification failure');
SELECT throws_ok($q$ SELECT public.request_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.report')::uuid,'PHI fixture retry') $q$,'P0001','synthetic_notification_failure','required notification failure rejects creation');
SELECT is((SELECT count(*) FROM public.deletion_requests WHERE status='requested'),0::bigint,'failed creation leaves no request');
DROP TRIGGER workflow_synthetic_failure ON public.notifications;
SELECT set_config('workflow.request3',public.request_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.report')::uuid,'PHI fixture third')::text,true);
CREATE TRIGGER workflow_synthetic_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_notification();
SELECT throws_ok($q$ SELECT public.decide_report_deletion('60000000-0000-4000-8000-000000000010',current_setting('workflow.request3')::uuid,'approve') $q$,'P0001','synthetic_notification_failure','required notification failure rejects a deletion decision');
SELECT is((SELECT status FROM public.deletion_requests WHERE id=current_setting('workflow.request3')::uuid),'requested','failed decision leaves request open');
SELECT ok((SELECT deleted_at IS NULL FROM public.reports WHERE id=current_setting('workflow.report')::uuid),'failed decision leaves report undeleted');
DROP TRIGGER workflow_synthetic_failure ON public.notifications;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"workflow-session-7"}',true);
SELECT is((SELECT count(*) FROM public.deletion_requests),0::bigint,'unrelated member cannot view another applicant request from the link');
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000008","role":"authenticated","session_id":"workflow-session-8"}',true);
SELECT is((SELECT count(*) FROM public.deletion_requests),0::bigint,'cross-tenant owner cannot view requests');
RESET ROLE;
-- Losing approve permission does not delete historical notifications or grant report access.
UPDATE public.organization_roles SET permissions='{"records":{"approve":"none","view":"none"},"management":{"reports":false}}' WHERE id='60000000-0000-4000-8000-000000000104';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"workflow-session-4"}',true);
SELECT ok((SELECT count(*)>0 FROM public.notifications),'former approver still sees their own notification history');
SELECT is((SELECT count(*) FROM public.reports WHERE id=current_setting('workflow.report')::uuid),0::bigint,'notification does not grant view permission after revocation');
SELECT throws_ok($q$ SELECT public.transition_reports_authorized('60000000-0000-4000-8000-000000000010',ARRAY[current_setting('workflow.report')::uuid],'approve') $q$,'42501','permission_denied_or_invalid','notification does not restore revoked approval permission');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
