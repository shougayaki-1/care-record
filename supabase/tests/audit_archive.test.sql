BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;
SELECT plan(34);
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
 'private.audit_archive_runs'::regclass, 'private.audit_archive_items'::regclass, 'private.audit_archive_progress'::regclass)), 'all preservation tables have RLS');
SELECT ok(NOT has_table_privilege('authenticated','private.audit_archive_items','SELECT'), 'business roles cannot read snapshots');
SELECT ok(NOT has_table_privilege('service_role','private.audit_archive_items','INSERT'), 'service role cannot forge snapshot rows directly');
SELECT ok(NOT has_function_privilege('anon','public.begin_audit_archive(jsonb,boolean)','EXECUTE'), 'anonymous cannot start a run');
SELECT ok(NOT has_function_privilege('authenticated','public.begin_audit_archive(jsonb,boolean)','EXECUTE'), 'authenticated cannot start a run');
SELECT ok(NOT has_function_privilege('authenticated','public.read_audit_archive(uuid,jsonb)','EXECUTE'), 'authenticated cannot page a run');
SELECT ok(NOT has_function_privilege('authenticated','public.cache_audit_archive(text,text,text)','EXECUTE'), 'authenticated cannot alter cache');
SELECT ok(has_function_privilege('service_role','public.read_audit_archive(uuid,jsonb)','EXECUTE'), 'preservation wrapper may page a run');
SELECT is((SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_events' AND column_name='integrity_version'), '1', 'B does not activate v2 writes');

CREATE TEMP TABLE archive_fixture_baseline AS SELECT count(*)::bigint AS total,
 count(*) FILTER (WHERE event_hash IS NULL AND organization_id IS NULL)::bigint AS null_global
 FROM public.audit_events;

-- Synthetic fixture only; disabling the v1 hash trigger here preserves a null
-- hash as an example of a historical anomaly. This entire test rolls back.
ALTER TABLE public.audit_events DISABLE TRIGGER audit_events_chain_insert;
INSERT INTO public.audit_events(action_type,resource_type,created_at,details)
 SELECT 'fixture.archive', 'audit', '2026-10-24T00:00:00.123456Z', jsonb_build_object('unicode', E'日本語\n', 'value', n)
 FROM generate_series(1,1001) n;
ALTER TABLE public.audit_events ENABLE TRIGGER audit_events_chain_insert;
CREATE TEMP TABLE archive_test_run AS SELECT public.begin_audit_archive()::uuid AS id;
SELECT is((SELECT count(*)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_run)), (SELECT (total+1001)::text FROM archive_fixture_baseline), 'snapshot includes 1001 equal-timestamp events');
SELECT is((SELECT count(*)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_run) AND payload->>'hash' IS NULL AND scope='global'), (SELECT (null_global+1001)::text FROM archive_fixture_baseline), 'NULL hash and global are preserved');
INSERT INTO public.audit_events(action_type,resource_type,created_at) VALUES('fixture.late','audit','2026-10-23');
SELECT is((SELECT count(*)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_run)), (SELECT (total+1001)::text FROM archive_fixture_baseline), 'late commit cannot extend an existing run');
CREATE TEMP TABLE archive_test_pages(page jsonb);
DO $$
DECLARE c jsonb := NULL; p jsonb; run uuid := (SELECT id FROM archive_test_run);
BEGIN
 LOOP
   p := public.read_audit_archive(run,c);
   INSERT INTO archive_test_pages VALUES(p);
   c := p->'cursor';
   EXIT WHEN NOT (p->>'more')::boolean;
 END LOOP;
END $$;
SELECT is((SELECT sum(jsonb_array_length(page->'items'))::text FROM archive_test_pages), (SELECT (total+1001)::text FROM archive_fixture_baseline), 'all pages cover every event');
SELECT is((SELECT count(DISTINCT e->>'id')::text FROM archive_test_pages CROSS JOIN LATERAL jsonb_array_elements(page->'items') e), (SELECT (total+1001)::text FROM archive_fixture_baseline), 'returned cursors neither skip nor duplicate');
SELECT ok((SELECT bool_and(octet_length(convert_to(page::text,'UTF8')) <= 524288 AND jsonb_array_length(page->'items') <= 500) FROM archive_test_pages), 'complete response respects row and byte caps');
SELECT ok((SELECT bool_and(convert_from(decode(e->>'inventory','base64'),'UTF8') LIKE '%2026-10-24T00:00:00.123456Z%') FROM archive_test_pages CROSS JOIN LATERAL jsonb_array_elements(page->'items') e WHERE convert_from(decode(e->>'inventory','base64'),'UTF8')::jsonb->>5='fixture.archive'), 'canonical inventory keeps microseconds');
SELECT ok((SELECT bool_and(payload->>'canonical' IS NULL) FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_run)), 'v1 is not rehashed with guessed historical settings');
CREATE TEMP TABLE archive_test_next AS SELECT public.begin_audit_archive()::uuid AS id;
-- Inspect the last created run in a later statement, not the function SELECT snapshot.
SELECT is((SELECT count(*)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_next)), (SELECT (total+1002)::text FROM archive_fixture_baseline), 'the next run includes late older-dated commits');
SELECT throws_ok($$SELECT public.read_audit_archive('00000000-0000-0000-0000-000000000000',NULL)$$, 'P0001', 'archive_run_missing', 'unknown run does not return an empty success');
SELECT lives_ok($$SELECT public.cache_audit_archive('fixture','9007199254740993',repeat('a',64))$$, 'large decimal cache position stays exact');
SELECT lives_ok($$SELECT public.cache_audit_archive('fixture','1',repeat('b',64))$$, 'stale publisher cannot move cache backwards');
SELECT is((SELECT ordinal FROM private.audit_archive_progress WHERE destination='fixture'), '9007199254740993', 'cache did not rewind');
INSERT INTO public.audit_events(id,action_type,resource_type,details)
 VALUES('ffffffff-ffff-ffff-ffff-ffffffffffff','fixture.large','audit',jsonb_build_object('data',repeat('x',500000)));
CREATE TEMP TABLE archive_test_large AS SELECT public.begin_audit_archive()::uuid AS id;
SELECT throws_ok(format('SELECT public.read_audit_archive(%L,%L::jsonb)', (SELECT id FROM archive_test_large), (SELECT jsonb_build_array('v1','global','0',id)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_large) AND id < (SELECT id FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_large) AND id='ffffffff-ffff-ffff-ffff-ffffffffffff') ORDER BY id DESC LIMIT 1)),
 'P0001', 'archive_row_too_large', 'single oversized row fails rather than being skipped');
SELECT ok(NOT has_function_privilege('anon','public.cache_audit_archive(text,text,text)','EXECUTE'), 'anonymous cannot forge cache');
SELECT ok(NOT has_table_privilege('anon','private.audit_archive_progress','UPDATE'), 'anonymous cannot write progress');
-- v2 activation is a rolled-back synthetic fixture, never a deployment path.
DROP TRIGGER audit_events_chain_insert ON public.audit_events;
CREATE TRIGGER audit_events_chain_insert BEFORE INSERT ON public.audit_events
 FOR EACH ROW EXECUTE FUNCTION private.chain_audit_event_v2('15000000-0000-4000-8000-000000000001');
ALTER TABLE public.audit_events ALTER COLUMN integrity_version SET DEFAULT 2;
INSERT INTO public.audit_events(action_type,resource_type,created_at)
 SELECT 'fixture.v2','audit','2026-10-24T00:00:00.123456Z' FROM generate_series(1,601);
INSERT INTO public.organizations(id,name) VALUES('15000000-0000-4000-8000-000000000002','Archive fixture');
INSERT INTO public.audit_events(organization_id,action_type,resource_type)
 VALUES('15000000-0000-4000-8000-000000000002','fixture.v2.org','audit');
CREATE TEMP TABLE archive_test_v2 AS SELECT public.begin_audit_archive('{}',false)::uuid AS id;
SELECT is((SELECT count(*)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_v2) AND kind='v2'), '602', 'v2 includes all scopes beyond 500 events');
SELECT is((SELECT count(*)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_v2) AND kind='head'), '2', 'scope list and heads share the frozen snapshot');
SELECT ok((SELECT bool_and(jsonb_typeof(payload->'sequence')='string') FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_v2)), 'every sequence is transported as decimal text');
SELECT ok((SELECT bool_and(payload->>'hash'=encode(extensions.digest(decode(payload->>'canonical','base64'),'sha256'),'hex')) FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_v2) AND kind='v2'), 'v2 canonical bytes retain their exact hash');
INSERT INTO public.audit_events(action_type,resource_type) VALUES('fixture.v2.later','audit');
SELECT is((SELECT max(sequence)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_v2) AND kind='v2' AND scope='global'), '601', 'new commits cannot move a frozen head');
CREATE TEMP TABLE archive_test_incremental AS SELECT public.begin_audit_archive('{"global":"601","org:15000000-0000-4000-8000-000000000002":"1"}',false)::uuid AS id;
SELECT is((SELECT count(*)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_incremental) AND kind='v2'), '1', 'subsequent runs freeze only the external unsaved v2 range');
SELECT is((SELECT count(*)::text FROM private.audit_archive_items WHERE run_id=(SELECT id FROM archive_test_incremental) AND kind='v1'), '0', 'finalized v1 is not duplicated every day');
CREATE TEMP TABLE archive_test_v2_pages(page jsonb);
DO $$
DECLARE c jsonb := '["v2","global","0","00000000-0000-0000-0000-000000000000"]'; p jsonb;
BEGIN
 LOOP
   p := public.read_audit_archive((SELECT id FROM archive_test_v2),c);
   INSERT INTO archive_test_v2_pages VALUES(p);
   c := p->'cursor';
   EXIT WHEN NOT (p->>'more')::boolean;
 END LOOP;
END $$;
SELECT is((SELECT sum(jsonb_array_length(page->'items'))::text FROM archive_test_v2_pages), '602', 'bounded v2 keyset pages cover all scopes and sequences');
SELECT ok((SELECT bool_and(octet_length(page::text)<=524288 AND jsonb_array_length(page->'items')<=500) FROM archive_test_v2_pages), 'all v2 response envelopes fit byte and row limits');
SELECT * FROM finish();
ROLLBACK;
