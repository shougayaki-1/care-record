BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES
 ('e1540000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','boundary-owner@example.invalid','synthetic',now(),now(),now()),
 ('e1540000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','boundary-admin@example.invalid','synthetic',now(),now(),now()),
 ('e1540000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','boundary-member@example.invalid','synthetic',now(),now(),now()),
 ('e1540000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','boundary-other@example.invalid','synthetic',now(),now(),now());
INSERT INTO public.profiles(id,name,role) VALUES
 ('e1540000-0000-4000-8000-000000000001','Synthetic owner',NULL),
 ('e1540000-0000-4000-8000-000000000002','Synthetic admin','super_admin')
ON CONFLICT (id) DO UPDATE SET role=excluded.role;
INSERT INTO public.organizations(id,name) VALUES ('e1540000-0000-4000-8000-000000000010','Synthetic organization');
INSERT INTO public.organization_members(organization_id,user_id,role) VALUES ('e1540000-0000-4000-8000-000000000010','e1540000-0000-4000-8000-000000000001','owner');
INSERT INTO public.organizations(id,name) VALUES ('e1540000-0000-4000-8000-000000000011','Other organization');
INSERT INTO public.organization_members(organization_id,user_id,role) VALUES ('e1540000-0000-4000-8000-000000000010','e1540000-0000-4000-8000-000000000003','member'), ('e1540000-0000-4000-8000-000000000011','e1540000-0000-4000-8000-000000000004','owner');
INSERT INTO public.clients(id,organization_id,name) VALUES ('e1540000-0000-4000-8000-000000000020','e1540000-0000-4000-8000-000000000010','Synthetic client');
INSERT INTO public.staffs(id,organization_id,user_id,name) VALUES ('e1540000-0000-4000-8000-000000000030','e1540000-0000-4000-8000-000000000010','e1540000-0000-4000-8000-000000000001','Synthetic staff');
INSERT INTO public.reports(id,client_id,helper_id) VALUES ('e1540000-0000-4000-8000-000000000040','e1540000-0000-4000-8000-000000000020','e1540000-0000-4000-8000-000000000001');
INSERT INTO public.report_values(report_id,data) VALUES ('e1540000-0000-4000-8000-000000000040','{"note":"synthetic"}');
INSERT INTO public.report_images(report_id,storage_path) VALUES ('e1540000-0000-4000-8000-000000000040','e1540000-0000-4000-8000-000000000010/e1540000-0000-4000-8000-000000000040/e1540000-0000-4000-8000-000000000050.webp');
INSERT INTO storage.objects(bucket_id,name) VALUES ('report-images','e1540000-0000-4000-8000-000000000010/e1540000-0000-4000-8000-000000000040/e1540000-0000-4000-8000-000000000050.webp');
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('report-images','e1540000-0000-4000-8000-000000000011/e1540000-0000-4000-8000-000000000040/e1540000-0000-4000-8000-000000000051.webp'),
 ('report-images','e1540000-0000-4000-8000-000000000010/e1540000-0000-4000-8000-000000000099/e1540000-0000-4000-8000-000000000052.webp'),
 ('report-images','e1540000-0000-4000-8000-000000000010/e1540000-0000-4000-8000-000000000040/not-a-uuid.webp');
INSERT INTO public.user_session_activity(session_hash,auth_session_id,user_id,last_activity,absolute_expires_at) VALUES
 ('issue154-owner','issue154-owner-session','e1540000-0000-4000-8000-000000000001',now(),now()+interval '1 hour'),
 ('issue154-admin','issue154-admin-session','e1540000-0000-4000-8000-000000000002',now(),now()+interval '1 hour'),
 ('issue210-member','issue210-member-session','e1540000-0000-4000-8000-000000000003',now(),now()+interval '1 hour'),
 ('issue210-other','issue210-other-session','e1540000-0000-4000-8000-000000000004',now(),now()+interval '1 hour');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1540000-0000-4000-8000-000000000001","role":"authenticated","session_id":"issue154-owner-session"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='e1540000-0000-4000-8000-000000000040'),1::bigint,'owner can read fixture report');
SELECT is((SELECT count(*) FROM public.report_values WHERE report_id='e1540000-0000-4000-8000-000000000040'),1::bigint,'owner can read fixture values');
SELECT is((SELECT count(*) FROM public.report_images WHERE report_id='e1540000-0000-4000-8000-000000000040'),1::bigint,'owner can read fixture image metadata');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='report-images' AND name LIKE 'e1540000-%'),1::bigint,'owner reads only the valid same-organization report object, not malformed or mismatched paths');
SELECT set_config('request.jwt.claims','{"sub":"e1540000-0000-4000-8000-000000000002","role":"authenticated","session_id":"issue154-admin-session"}',true);
SELECT is((SELECT count(*) FROM public.reports WHERE id='e1540000-0000-4000-8000-000000000040'),0::bigint,'unaffiliated super-admin cannot read reports');
SELECT is((SELECT count(*) FROM public.report_values WHERE report_id='e1540000-0000-4000-8000-000000000040'),0::bigint,'unaffiliated super-admin cannot read values');
SELECT is((SELECT count(*) FROM public.report_images WHERE report_id='e1540000-0000-4000-8000-000000000040'),0::bigint,'unaffiliated super-admin cannot read image metadata');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='report-images' AND name LIKE 'e1540000-%'),0::bigint,'unaffiliated super-admin cannot select storage object');
SELECT throws_ok($$ SELECT public.save_report_autosave_authorized('e1540000-0000-4000-8000-000000000010','e1540000-0000-4000-8000-000000000020','e1540000-0000-4000-8000-000000000040','e1540000-0000-4000-8000-000000000060',0,0,'{}'::jsonb) $$,'42501','permission_denied','unaffiliated super-admin cannot write through autosave RPC');
SELECT set_config('request.jwt.claims','{"sub":"e1540000-0000-4000-8000-000000000003","role":"authenticated","session_id":"issue210-member-session"}',true);
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='report-images' AND name LIKE 'e1540000-%'),0::bigint,'member without records permission cannot read image');
SELECT set_config('request.jwt.claims','{"sub":"e1540000-0000-4000-8000-000000000004","role":"authenticated","session_id":"issue210-other-session"}',true);
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='report-images' AND name LIKE 'e1540000-%'),0::bigint,'other organization owner cannot read image');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
