BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT no_plan();
SELECT ok(NOT has_function_privilege('anon','public.read_audit_verification_snapshot(uuid,jsonb)','EXECUTE'),'anon cannot read verification pages');
SELECT ok(NOT has_function_privilege('authenticated','public.read_audit_verification_snapshot(uuid,jsonb)','EXECUTE'),'authenticated cannot read verification pages');
SELECT ok(has_function_privilege('service_role','public.read_audit_verification_snapshot(uuid,jsonb)','EXECUTE'),'service role can read verification pages');
INSERT INTO private.audit_archive_runs(id,started_at) VALUES
 ('15200000-0000-4000-8000-000000000201',now()),
 ('15200000-0000-4000-8000-000000000202',now()),
 ('15200000-0000-4000-8000-000000000203',now()),
 ('15200000-0000-4000-8000-000000000204',now()),
 ('15200000-0000-4000-8000-000000000205',now());
INSERT INTO private.audit_archive_items(run_id,kind,scope,sequence,id,payload)
SELECT run_id,'v1','global',0,('15200000-0000-4000-8001-' || lpad(n::text,12,'0'))::uuid,
 jsonb_build_object('id',n,'unicode',CASE WHEN run_id::text LIKE '%202' THEN repeat('あ"\\',250) ELSE 'x' END)
FROM generate_series(1,501) n CROSS JOIN (VALUES
 ('15200000-0000-4000-8000-000000000201'::uuid),('15200000-0000-4000-8000-000000000202'::uuid)) AS r(run_id);
INSERT INTO private.audit_archive_items(run_id,kind,scope,sequence,id,payload)
VALUES ('15200000-0000-4000-8000-000000000203','v1','global',0,'15200000-0000-4000-8001-000000000001',jsonb_build_object('large',repeat('x',524288)));
-- The candidate response uses `more:true`, but the final response can use
-- `false`, which is one byte longer. Exercise both sides of that boundary.
INSERT INTO private.audit_archive_items(run_id,kind,scope,sequence,id,payload)
SELECT run_id,'v1','global',0,id,jsonb_build_object('x',repeat('x',
  524288 - octet_length(convert_to(jsonb_build_object('items','[]'::jsonb,'cursor',jsonb_build_array('v1','global','0',id),'more',true)::text,'UTF8'))
  - octet_length(convert_to(jsonb_build_object('x','')::text,'UTF8')) - adjustment))
FROM (VALUES
 ('15200000-0000-4000-8000-000000000204'::uuid,'15200000-0000-4000-8001-000000000004'::uuid,0),
 ('15200000-0000-4000-8000-000000000205'::uuid,'15200000-0000-4000-8001-000000000005'::uuid,1)) AS b(run_id,id,adjustment);
SELECT throws_ok($$ SELECT public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000204',NULL) $$,'P0001','archive_row_too_large','reserves the final false byte at the exact boundary');
SELECT ok(octet_length(convert_to(public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000205',NULL)::text,'UTF8')) <= 524288,'one byte below candidate boundary produces a bounded final response');
SELECT is(public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000201',NULL),
 public.read_audit_archive('15200000-0000-4000-8000-000000000201',NULL),'501 small rows: first page matches existing reader');
SELECT is(public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000201',
 public.read_audit_archive('15200000-0000-4000-8000-000000000201',NULL)->'cursor'),
 public.read_audit_archive('15200000-0000-4000-8000-000000000201',
 public.read_audit_archive('15200000-0000-4000-8000-000000000201',NULL)->'cursor'),'501 small rows: final page matches existing reader');
SELECT is(public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000202',NULL),
 public.read_audit_archive('15200000-0000-4000-8000-000000000202',NULL),'UTF-8 and escaped payloads: byte-limited first page matches');
SELECT is(public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000202',
 public.read_audit_archive('15200000-0000-4000-8000-000000000202',NULL)->'cursor'),
 public.read_audit_archive('15200000-0000-4000-8000-000000000202',
 public.read_audit_archive('15200000-0000-4000-8000-000000000202',NULL)->'cursor'),'byte-limited continuation matches');
SELECT is(public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000201',
 '["v1","global","0","15200000-0000-4000-8001-000000000501"]'::jsonb),
 jsonb_build_object('items','[]'::jsonb,'cursor','["v1","global","0","15200000-0000-4000-8001-000000000501"]'::jsonb,'more',false),'exhausted page preserves cursor');
SELECT throws_ok($$ SELECT public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000299',NULL) $$,'P0001','archive_run_missing','missing snapshot rejected');
SELECT throws_ok($$ SELECT public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000203',NULL) $$,'P0001','archive_row_too_large','oversized first item is rejected');
SELECT throws_ok($$ SELECT public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000201','[]') $$,'P0001','archive_cursor_invalid','invalid cursor rejected');
SET LOCAL ROLE service_role;
SELECT is(jsonb_array_length(public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000201',NULL)->'items'),500,'service role can execute a bounded page');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.read_audit_verification_snapshot('15200000-0000-4000-8000-000000000201',NULL) $$,'42501',NULL,'authenticated cannot execute reader');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
