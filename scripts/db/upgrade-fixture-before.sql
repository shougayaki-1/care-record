-- Synthetic data committed before applying the migration delta in a disposable DB.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('c1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ci-upgrade@example.invalid','synthetic',now(),now(),now());
INSERT INTO public.profiles(id,name) VALUES ('c1000000-0000-4000-8000-000000000001','Synthetic upgrade actor') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.organizations(id,name) VALUES ('c1000000-0000-4000-8000-000000000010','Synthetic upgrade organization');
INSERT INTO public.organization_members(organization_id,user_id,role)
VALUES ('c1000000-0000-4000-8000-000000000010','c1000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.clients(id,organization_id,name)
VALUES ('c1000000-0000-4000-8000-000000000020','c1000000-0000-4000-8000-000000000010','Synthetic upgrade client');
INSERT INTO public.reports(id,client_id,helper_id,status,service_date,start_at,end_at,approved_by,approved_at,deleted_at)
SELECT ('c1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'c1000000-0000-4000-8000-000000000020','c1000000-0000-4000-8000-000000000001',
 CASE WHEN n=31 THEN 'approved' ELSE 'pending' END, '2026-10-01',
 '2026-10-01 01:00:00+00','2026-10-01 02:00:00+00',
 CASE WHEN n=31 THEN 'c1000000-0000-4000-8000-000000000001'::uuid END,
 CASE WHEN n=31 THEN '2026-10-02 01:00:00+00'::timestamptz END,
 CASE WHEN n=32 THEN '2026-10-03 01:00:00+00'::timestamptz END
FROM generate_series(30,32) n;
INSERT INTO public.audit_events(organization_id,actor_id,action_type,resource_type,resource_id,details)
VALUES ('c1000000-0000-4000-8000-000000000010','c1000000-0000-4000-8000-000000000001',
 'ci.upgrade_fixture','report','c1000000-0000-4000-8000-000000000031','{"synthetic":true}');

CREATE SCHEMA ci_upgrade_fixture;
REVOKE ALL ON SCHEMA ci_upgrade_fixture FROM PUBLIC, anon, authenticated;
CREATE FUNCTION ci_upgrade_fixture.state() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
 SELECT jsonb_build_object(
  'reports', (SELECT jsonb_agg(jsonb_build_object('id',id,'client',client_id,'helper',helper_id,
    'status',status,'service_date',service_date,'start',start_at,'end',end_at,'deleted',deleted_at,
    'approver',approved_by,'approved',approved_at) ORDER BY id)
    FROM public.reports WHERE client_id='c1000000-0000-4000-8000-000000000020'),
  'versions', (SELECT jsonb_agg(jsonb_build_object('id',id,'resource',resource_id,'version',version_number,
    'snapshot',snapshot,'hash',snapshot_hash,'previous_hash',previous_hash,'actor',actor_id,
    'reason',change_reason,'session',session_id) ORDER BY id)
    FROM public.record_versions WHERE organization_id='c1000000-0000-4000-8000-000000000010'),
  'audit', (SELECT jsonb_agg(jsonb_build_object('id',id,'event_id',event_id,'action',action_type,
    'resource',resource_id,'details',details,'hash',event_hash,'previous_hash',previous_hash) ORDER BY id)
    FROM public.audit_events WHERE organization_id='c1000000-0000-4000-8000-000000000010'),
  'membership', (SELECT jsonb_agg(jsonb_build_object('user',user_id,'role',role) ORDER BY user_id)
    FROM public.organization_members WHERE organization_id='c1000000-0000-4000-8000-000000000010'));
$fn$;
REVOKE ALL ON FUNCTION ci_upgrade_fixture.state() FROM PUBLIC, anon, authenticated;
CREATE TABLE ci_upgrade_fixture.expected AS SELECT ci_upgrade_fixture.state() AS value;
DO $check$
DECLARE state jsonb := ci_upgrade_fixture.state();
BEGIN
 IF jsonb_array_length(state->'reports') <> 3 OR coalesce(jsonb_array_length(state->'versions'),0) < 3
   OR coalesce(jsonb_array_length(state->'audit'),0) < 1 THEN
  RAISE EXCEPTION 'Upgrade fixture did not exercise reports, versions and audit';
 END IF;
END $check$;
COMMIT;
