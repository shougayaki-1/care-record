BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('15500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'session-boundary@example.invalid', 'synthetic', now(), now(), now());
INSERT INTO public.profiles(id, name) VALUES ('15500000-0000-4000-8000-000000000001', 'Synthetic owner')
ON CONFLICT (id) DO UPDATE SET name=excluded.name;
INSERT INTO public.organizations(id, name) VALUES ('15500000-0000-4000-8000-000000000010', 'Synthetic organization');
INSERT INTO public.organization_members(organization_id, user_id, role)
VALUES ('15500000-0000-4000-8000-000000000010', '15500000-0000-4000-8000-000000000001', 'owner');
INSERT INTO public.clients(id, organization_id, name)
VALUES ('15500000-0000-4000-8000-000000000020', '15500000-0000-4000-8000-000000000010', 'Synthetic client');
INSERT INTO public.organizations(id, name) VALUES ('15500000-0000-4000-8000-000000000011', 'Other synthetic organization');
INSERT INTO public.clients(id, organization_id, name) VALUES
 ('15500000-0000-4000-8000-000000000021', '15500000-0000-4000-8000-000000000010', 'Unassigned client'),
 ('15500000-0000-4000-8000-000000000022', '15500000-0000-4000-8000-000000000011', 'Other organization client');
INSERT INTO public.reports(id, client_id, helper_id)
VALUES ('15500000-0000-4000-8000-000000000030', '15500000-0000-4000-8000-000000000020', '15500000-0000-4000-8000-000000000001');
INSERT INTO public.reports(id, client_id, helper_id) VALUES
 ('15500000-0000-4000-8000-000000000031', '15500000-0000-4000-8000-000000000021', '15500000-0000-4000-8000-000000000001'),
 ('15500000-0000-4000-8000-000000000032', '15500000-0000-4000-8000-000000000022', '15500000-0000-4000-8000-000000000001');
INSERT INTO public.shifts(id, organization_id, client_id, start_at, end_at) VALUES
 ('15500000-0000-4000-8000-000000000060', '15500000-0000-4000-8000-000000000010', '15500000-0000-4000-8000-000000000020', now(), now()+interval '1 hour'),
 ('15500000-0000-4000-8000-000000000061', '15500000-0000-4000-8000-000000000010', '15500000-0000-4000-8000-000000000021', now(), now()+interval '1 hour');
INSERT INTO public.user_session_activity(session_hash, auth_session_id, user_id, last_activity, absolute_expires_at, revoked_at)
VALUES
 ('155-active', '155-active', '15500000-0000-4000-8000-000000000001', now(), now()+interval '1 hour', NULL),
 ('155-revoked', '155-revoked', '15500000-0000-4000-8000-000000000001', now(), now()+interval '1 hour', now()),
 ('155-idle', '155-idle', '15500000-0000-4000-8000-000000000001', now()-interval '25 hours', now()+interval '1 hour', NULL),
 ('155-expired', '155-expired', '15500000-0000-4000-8000-000000000001', now(), now()-interval '1 second', NULL);
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('15500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'session-member@example.invalid', 'synthetic', now(), now(), now());
INSERT INTO public.profiles(id, name) VALUES ('15500000-0000-4000-8000-000000000002', 'Synthetic member')
ON CONFLICT (id) DO UPDATE SET name=excluded.name;
INSERT INTO public.organization_members(organization_id, user_id, role)
VALUES ('15500000-0000-4000-8000-000000000010', '15500000-0000-4000-8000-000000000002', 'member');
INSERT INTO public.organization_roles(id, organization_id, name, color, is_preset, permissions)
VALUES ('15500000-0000-4000-8000-000000000050', '15500000-0000-4000-8000-000000000010', 'Synthetic role', '#000000', false, '{"records":{"view":"all","edit":"all"}}');
INSERT INTO public.organization_member_roles(organization_id, user_id, role_id)
VALUES ('15500000-0000-4000-8000-000000000010', '15500000-0000-4000-8000-000000000002', '15500000-0000-4000-8000-000000000050');
INSERT INTO public.user_session_activity(session_hash, auth_session_id, user_id, last_activity, absolute_expires_at)
VALUES ('155-member', '155-member', '15500000-0000-4000-8000-000000000002', now(), now()+interval '1 hour');
INSERT INTO public.assignments(client_id, helper_id)
VALUES ('15500000-0000-4000-8000-000000000020', '15500000-0000-4000-8000-000000000002');

INSERT INTO public.staffs(id,organization_id,user_id,name) VALUES
 ('15500000-0000-4000-8000-000000000081','15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000002','Synthetic own'),
 ('15500000-0000-4000-8000-000000000082','15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000001','Synthetic other'),
 ('15500000-0000-4000-8000-000000000083','15500000-0000-4000-8000-000000000011',NULL,'Synthetic foreign');
INSERT INTO public.internal_work_records(id,organization_id,staff_id,recorded_by,title,start_at,end_at,work_hours) VALUES
 ('15500000-0000-4000-8000-000000000091','15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000081','15500000-0000-4000-8000-000000000002','Own',now(),now()+interval '1 hour',1),
 ('15500000-0000-4000-8000-000000000092','15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000082','15500000-0000-4000-8000-000000000001','Other',now(),now()+interval '1 hour',1),
 ('15500000-0000-4000-8000-000000000093','15500000-0000-4000-8000-000000000011','15500000-0000-4000-8000-000000000083','15500000-0000-4000-8000-000000000001','Foreign',now(),now()+interval '1 hour',1);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"155-active"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),1::bigint,'active owner session reads the report');
SELECT lives_ok($$ SELECT public.save_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000020','15500000-0000-4000-8000-000000000030','15500000-0000-4000-8000-000000000040',0,1,'{"synthetic":true}'::jsonb) $$,'active owner session saves a draft');
SELECT lives_ok($$ SELECT public.replace_shift_staffs_atomic('15500000-0000-4000-8000-000000000060',ARRAY[]::uuid[]) $$,'active owner session can update shift staffing');

SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"155-revoked"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'revoked session cannot read the report');
SELECT throws_ok($$ SELECT public.replace_shift_staffs_atomic('15500000-0000-4000-8000-000000000060',ARRAY[]::uuid[]) $$,'P0001','access denied','revoked session cannot update shift staffing');

SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"155-idle"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'idle session cannot read the report');
SELECT throws_ok($$ SELECT public.replace_shift_staffs_atomic('15500000-0000-4000-8000-000000000060',ARRAY[]::uuid[]) $$,'P0001','access denied','idle session cannot update shift staffing');
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"155-expired"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'expired session cannot read the report');
SELECT throws_ok($$ SELECT public.replace_shift_staffs_atomic('15500000-0000-4000-8000-000000000060',ARRAY[]::uuid[]) $$,'P0001','access denied','expired session cannot update shift staffing');
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"155-unknown"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'unknown session cannot read the report');
SELECT throws_ok($$ SELECT public.replace_shift_staffs_atomic('15500000-0000-4000-8000-000000000060',ARRAY[]::uuid[]) $$,'P0001','access denied','unknown session cannot update shift staffing');
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"155-member"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'owner cannot read with another user''s active session');
SELECT throws_ok($$ SELECT public.replace_shift_staffs_atomic('15500000-0000-4000-8000-000000000060',ARRAY[]::uuid[]) $$,'P0001','access denied','owner cannot update shift staffing with another user''s active session');
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000002","role":"authenticated","session_id":"155-active"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'member cannot read with the owner''s active session');
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000002","role":"authenticated","session_id":"155-member"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),1::bigint,'member with view permission reads the report');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{"internalWork":{"view":"assigned"}}' WHERE id='15500000-0000-4000-8000-000000000050';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.internal_work_records WHERE id='15500000-0000-4000-8000-000000000091'),1::bigint,'assigned member reads own internal work');
SELECT is((SELECT count(*) FROM public.internal_work_records WHERE id IN ('15500000-0000-4000-8000-000000000092','15500000-0000-4000-8000-000000000093')),0::bigint,'assigned member cannot read other or foreign internal work');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{"internalWork":{"view":"all"}}' WHERE id='15500000-0000-4000-8000-000000000050';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.internal_work_records WHERE id IN ('15500000-0000-4000-8000-000000000091','15500000-0000-4000-8000-000000000092')),2::bigint,'all scope reads both organization records');
SELECT is((SELECT count(*) FROM public.internal_work_records WHERE id='15500000-0000-4000-8000-000000000093'),0::bigint,'all scope cannot read other organization internal work');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{"internalWork":{"view":"none"}}' WHERE id='15500000-0000-4000-8000-000000000050';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.internal_work_records WHERE id='15500000-0000-4000-8000-000000000091'),0::bigint,'none scope cannot read own internal work');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{"records":{"view":"all","edit":"all"}}' WHERE id='15500000-0000-4000-8000-000000000050';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.save_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000020','15500000-0000-4000-8000-000000000030','15500000-0000-4000-8000-000000000041',0,1,'{}'::jsonb) $$,'member with edit permission saves a draft');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{"records":{"view":"none","edit":"none"}}' WHERE id='15500000-0000-4000-8000-000000000050';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'member loses report access after permission removal');
SELECT throws_ok($$ SELECT public.load_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000041') $$,'42501','permission_denied','member loses draft access after permission removal');
SELECT throws_ok($$ SELECT public.save_report_versioned('15500000-0000-4000-8000-000000000010',NULL,'15500000-0000-4000-8000-000000000020',NULL,NULL,now(),now()+interval '1 hour','draft','{}'::jsonb,0,'15500000-0000-4000-8000-000000000073') $$,'P0001','access_denied','member cannot create report after permission removal');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{"records":{"view":"assigned","edit":"assigned","create":"assigned","approve":"assigned"},"shifts":{"view":"assigned"},"management":{"reports":true}}' WHERE id='15500000-0000-4000-8000-000000000050';
UPDATE public.reports SET status='pending' WHERE id IN ('15500000-0000-4000-8000-000000000030','15500000-0000-4000-8000-000000000031','15500000-0000-4000-8000-000000000032');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.transition_reports_authorized('15500000-0000-4000-8000-000000000010',ARRAY['15500000-0000-4000-8000-000000000030'::uuid,'15500000-0000-4000-8000-000000000031'::uuid],'approve') $$,'22023','invalid_or_inaccessible_reports','mixed assigned and unassigned approval rejected');
SELECT is((SELECT status FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),'pending','mixed approval did not change the assigned report');
SELECT throws_ok($$ SELECT public.transition_reports_authorized('15500000-0000-4000-8000-000000000010',ARRAY['15500000-0000-4000-8000-000000000030'::uuid,'15500000-0000-4000-8000-000000000032'::uuid],'approve') $$,'22023','invalid_or_inaccessible_reports','mixed assigned and foreign organization approval rejected');
SELECT is((SELECT status FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),'pending','foreign organization approval request did not change the assigned report');
SELECT lives_ok($$ SELECT public.transition_reports_authorized('15500000-0000-4000-8000-000000000010',ARRAY['15500000-0000-4000-8000-000000000030'::uuid],'approve') $$,'assigned report can be approved');
SELECT is((SELECT status FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),'approved','authorized approval actually changes status');
RESET ROLE;
SELECT is((SELECT status FROM public.reports WHERE id='15500000-0000-4000-8000-000000000031'),'pending','unassigned report remains pending');
SELECT is((SELECT status FROM public.reports WHERE id='15500000-0000-4000-8000-000000000032'),'pending','foreign organization report remains pending');
UPDATE public.reports SET status='draft',approved_by=NULL,approved_at=NULL WHERE id='15500000-0000-4000-8000-000000000030';
INSERT INTO public.retention_policies(organization_id,resource_type,retention_years,legal_basis) VALUES ('15500000-0000-4000-8000-000000000010','report',10,'synthetic policy') ON CONFLICT (organization_id,resource_type) DO NOTHING;
UPDATE public.organization_roles SET permissions='{"records":{"view":"assigned","edit":"assigned","delete":"assigned"}}' WHERE id='15500000-0000-4000-8000-000000000050';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.soft_delete_reports_authorized('15500000-0000-4000-8000-000000000010',ARRAY['15500000-0000-4000-8000-000000000030'::uuid,'15500000-0000-4000-8000-000000000031'::uuid],'synthetic reason') $$,'22023','invalid_or_inaccessible_reports','mixed assigned and unassigned deletion rejected');
SELECT throws_ok($$ SELECT public.soft_delete_reports_authorized('15500000-0000-4000-8000-000000000010',ARRAY['15500000-0000-4000-8000-000000000030'::uuid,'15500000-0000-4000-8000-000000000032'::uuid],'synthetic reason') $$,'22023','invalid_or_inaccessible_reports','mixed assigned and foreign organization deletion rejected');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.reports WHERE id IN ('15500000-0000-4000-8000-000000000030','15500000-0000-4000-8000-000000000031','15500000-0000-4000-8000-000000000032') AND deleted_at IS NULL),3::bigint,'mixed deletion changes no assigned, unassigned or foreign record');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.soft_delete_reports_authorized('15500000-0000-4000-8000-000000000010',ARRAY['15500000-0000-4000-8000-000000000030'::uuid],'synthetic reason') $$,'assigned report can be soft deleted');
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'deleted report is hidden from assigned member');
SELECT throws_ok($$ SELECT public.save_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000020','15500000-0000-4000-8000-000000000030','15500000-0000-4000-8000-000000000041',0,2,'{}'::jsonb) $$,'42501','permission_denied','cannot save draft against deleted report');
RESET ROLE;
SELECT ok((SELECT deleted_at IS NOT NULL AND retention_until IS NOT NULL FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),'authorized deletion retains report with retention deadline');
UPDATE public.reports SET deleted_at=NULL,deleted_by=NULL,deletion_reason=NULL,retention_until=NULL WHERE id='15500000-0000-4000-8000-000000000030';
UPDATE public.organization_roles SET permissions='{"records":{"view":"assigned","edit":"assigned","create":"assigned"},"shifts":{"view":"assigned"}}' WHERE id='15500000-0000-4000-8000-000000000050';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),1::bigint,'assigned member reads assigned report');
SELECT lives_ok($$ SELECT public.save_report_versioned('15500000-0000-4000-8000-000000000010',NULL,'15500000-0000-4000-8000-000000000020',NULL,NULL,now(),now()+interval '1 hour','draft','{}'::jsonb,0,'15500000-0000-4000-8000-000000000071') $$,'assigned member creates assigned report via versioned RPC');
SELECT is((SELECT count(*) FROM public.reports WHERE client_id='15500000-0000-4000-8000-000000000020'),2::bigint,'assigned report was actually created');
SELECT throws_ok($$ SELECT public.save_report_versioned('15500000-0000-4000-8000-000000000010',NULL,'15500000-0000-4000-8000-000000000021',NULL,NULL,now(),now()+interval '1 hour','draft','{}'::jsonb,0,'15500000-0000-4000-8000-000000000072') $$,'P0001','access_denied','assigned member cannot create unassigned report via versioned RPC');
SELECT throws_ok($$ SELECT public.save_report_versioned('15500000-0000-4000-8000-000000000011',NULL,'15500000-0000-4000-8000-000000000022',NULL,NULL,now(),now()+interval '1 hour','draft','{}'::jsonb,0,'15500000-0000-4000-8000-000000000074') $$,'P0001','access_denied','assigned member cannot create other organization report');
SELECT is((SELECT count(*) FROM public.reports WHERE id IN ('15500000-0000-4000-8000-000000000031','15500000-0000-4000-8000-000000000032')),0::bigint,'assigned member cannot read unassigned or other organization reports');
SELECT lives_ok($$ SELECT public.save_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000020','15500000-0000-4000-8000-000000000030','15500000-0000-4000-8000-000000000041',0,2,'{}'::jsonb) $$,'assigned member edits assigned client draft');
SELECT throws_ok($$ SELECT public.save_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000021','15500000-0000-4000-8000-000000000031','15500000-0000-4000-8000-000000000042',0,1,'{}'::jsonb) $$,'42501','permission_denied','assigned member cannot edit unassigned client draft');
SELECT throws_ok($$ SELECT public.save_report_autosave_authorized('15500000-0000-4000-8000-000000000011','15500000-0000-4000-8000-000000000022','15500000-0000-4000-8000-000000000032','15500000-0000-4000-8000-000000000043',0,1,'{}'::jsonb) $$,'42501','permission_denied','assigned member cannot edit other organization draft');
SELECT is((SELECT count(*) FROM public.shifts WHERE id='15500000-0000-4000-8000-000000000060'),1::bigint,'assigned member reads assigned shift');
SELECT is((SELECT count(*) FROM public.shifts WHERE id='15500000-0000-4000-8000-000000000061'),0::bigint,'assigned member cannot read unassigned shift');
RESET ROLE;
UPDATE public.assignments SET helper_id=NULL WHERE client_id='15500000-0000-4000-8000-000000000020';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'member loses report access after assignment removal');
SELECT is((SELECT count(*) FROM public.shifts WHERE id='15500000-0000-4000-8000-000000000060'),0::bigint,'member loses shift access after assignment removal');
SELECT throws_ok($$ SELECT public.load_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000041') $$,'42501','permission_denied','member loses draft access after assignment removal');
RESET ROLE;
UPDATE public.organization_roles SET permissions='{"records":{"view":"all","edit":"all"},"shifts":{"view":"all"}}' WHERE id='15500000-0000-4000-8000-000000000050';
SAVEPOINT before_member_removal;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000002","role":"authenticated","session_id":"155-member"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),1::bigint,'member reads report before removal');
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000001","role":"authenticated","session_id":"155-active"}',true);
SELECT lives_ok($$ SELECT public.account_remove('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000002','active') $$,'owner removes member through the existing RPC');
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000002","role":"authenticated","session_id":"155-member"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'removed member cannot read report with old session');
SELECT throws_ok($$ SELECT public.load_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000041') $$,'42501','permission_denied','removed member cannot read draft with old session');
RESET ROLE;
ROLLBACK TO SAVEPOINT before_member_removal;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000002","role":"authenticated","session_id":"155-member"}',true);
SELECT lives_ok($$ SELECT public.leave_organization_atomic('15500000-0000-4000-8000-000000000010') $$,'member leaves through the existing RPC');
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'former member cannot read report with old session');
SELECT throws_ok($$ SELECT public.load_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000041') $$,'42501','permission_denied','former member cannot read draft with old session');
RESET ROLE;
ROLLBACK TO SAVEPOINT before_member_removal;
INSERT INTO public.reauth_grants(token_hash,user_id,auth_session_id,purpose,expires_at)
VALUES (encode(extensions.digest('synthetic-deletion-proof','sha256'),'hex'),'15500000-0000-4000-8000-000000000002','155-member','account_delete',now()+interval '10 minutes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15500000-0000-4000-8000-000000000002","role":"authenticated","session_id":"155-member"}',true);
SELECT lives_ok($$ SELECT public.request_own_account_deletion('synthetic retention basis','synthetic-deletion-proof') $$,'member requests account deletion with a valid proof');
SELECT is((SELECT count(*) FROM public.reports WHERE id='15500000-0000-4000-8000-000000000030'),0::bigint,'account-deletion requester cannot read report with old session');
SELECT throws_ok($$ SELECT public.load_report_autosave_authorized('15500000-0000-4000-8000-000000000010','15500000-0000-4000-8000-000000000041') $$,'42501','permission_denied','account-deletion requester cannot read draft with old session');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
