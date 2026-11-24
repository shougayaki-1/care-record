BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT is((SELECT pg_get_expr(adbin,adrelid) FROM pg_attrdef
 WHERE adrelid='public.audit_events'::regclass AND adnum=(SELECT attnum FROM pg_attribute
 WHERE attrelid='public.audit_events'::regclass AND attname='integrity_version')), '1', 'preparation keeps the v1 default');
SELECT is((SELECT tgfoid::regproc::text FROM pg_trigger WHERE tgrelid='public.audit_events'::regclass
 AND tgname='audit_events_chain_insert'), 'private.chain_audit_event', 'preparation keeps the v1 trigger');
INSERT INTO public.audit_events(action_type,resource_type) VALUES ('fixture.v1','test');
SELECT ok((SELECT integrity_version=1 AND chain_scope IS NULL AND chain_sequence IS NULL
 AND chain_cutover_id IS NULL AND event_hash=encode(extensions.digest(private.audit_canonical_v1(audit_events),'sha256'),'hex')
 FROM public.audit_events WHERE action_type='fixture.v1'), 'old application INSERT remains a valid v1 event');
SELECT is((SELECT count(*) FROM private.audit_chain_heads), 0::bigint, 'v1 creates no v2 heads');
SELECT col_is_unique('public','audit_events',ARRAY['chain_scope','chain_sequence'],'scope and sequence have a database uniqueness constraint');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.audit_chain_heads'::regclass), 'internal heads have RLS');
SELECT ok(NOT has_table_privilege(r,'private.audit_chain_heads',p), r||' cannot '||p||' heads')
 FROM unnest(ARRAY['anon','authenticated','service_role']) r,
 unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
SELECT ok(NOT has_function_privilege(r,p.oid,'EXECUTE'),r||' cannot execute '||p.proname)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
 unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE n.nspname='private' AND p.proname IN ('audit_canonical_v1','audit_canonical_v2','audit_genesis_v2','chain_audit_event_v2','check_audit_head_event_v2','check_audit_event_v2');

SELECT throws_ok($query$DO $body$ BEGIN
 INSERT INTO public.audit_events(action_type,resource_type,integrity_version,chain_scope,chain_sequence,chain_cutover_id)
 VALUES ('forged-before-cutover','test',2,'global',1,'14900000-0000-4000-8000-000000000001');
 SET CONSTRAINTS ALL IMMEDIATE;
END; $body$ $query$, '23514','audit_v2_unallocated_event','preparation refuses caller-forged v2 rows through v1 trigger');

-- Fixed PG17 canonical fixture, independent of the insertion trigger.
CREATE TEMP TABLE canonical_fixture AS SELECT jsonb_populate_record(NULL::public.audit_events,
 '{"integrity_version":2,"chain_cutover_id":"14900000-0000-4000-8000-000000000001","chain_scope":"global","chain_sequence":9007199254740993,"id":"14900000-0000-4000-8000-000000000002","event_id":"14900000-0000-4000-8000-000000000003","action_type":"fixture.日本語","resource_type":"test","resource_id":"","outcome":"success","reason":"行1\n行2|😀","created_at":"2026-10-24T01:02:03.123456Z","details":{"x":"é\n|"},"user_agent":"","previous_hash":"GENESIS:v2:14900000-0000-4000-8000-000000000001:global"}'::jsonb) AS e;
CREATE TEMP TABLE canonical_expected(bytes bytea);
INSERT INTO canonical_expected VALUES(convert_to($json$[2, "14900000-0000-4000-8000-000000000001", "global", "9007199254740993", "14900000-0000-4000-8000-000000000002", "14900000-0000-4000-8000-000000000003", null, null, "fixture.日本語", "test", "", "success", null, null, "行1\n行2|😀", "2026-10-24T01:02:03.123456Z", {"x": "é\n|"}, null, "", "GENESIS:v2:14900000-0000-4000-8000-000000000001:global"]$json$, 'UTF8'));
SET LOCAL TimeZone='Asia/Tokyo';
SET LOCAL DateStyle='SQL, DMY';
SELECT is(private.audit_canonical_v2(e), bytes, 'PG17 fixed bytes: Unicode, newline, null, empty, bigint, UTC microseconds') FROM canonical_fixture, canonical_expected;
SET LOCAL TimeZone='America/New_York';
SET LOCAL DateStyle='German, DMY';
SELECT is(private.audit_canonical_v2(e), bytes, 'same fixed bytes in another TimeZone/DateStyle') FROM canonical_fixture, canonical_expected;
SELECT isnt(private.audit_canonical_v2(e),private.audit_canonical_v2(jsonb_populate_record(e,'{"resource_id":null}')), 'empty differs from NULL') FROM canonical_fixture;

-- Nonproduction activation fixture ONLY; rolled back with every test effect.
DROP TRIGGER audit_events_chain_insert ON public.audit_events;
CREATE TRIGGER audit_events_chain_insert BEFORE INSERT ON public.audit_events FOR EACH ROW
 EXECUTE FUNCTION private.chain_audit_event_v2('14900000-0000-4000-8000-000000000001');
ALTER TABLE public.audit_events ALTER COLUMN integrity_version SET DEFAULT 2;
INSERT INTO public.audit_events(id, action_type,resource_type,created_at) VALUES
 ('14900000-0000-4000-8000-000000000009','fixture.v2','test','2026-10-24T01:00:00Z'),
 ('14900000-0000-4000-8000-000000000008','fixture.v2','test','2026-10-24T01:00:00Z');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT is((SELECT chain_sequence FROM public.audit_events WHERE id='14900000-0000-4000-8000-000000000008'), 2::bigint, 'multiple rows use insertion order despite reverse UUID and same timestamp');
SELECT is((SELECT last_sequence FROM private.audit_chain_heads WHERE scope='global'), 2::bigint, 'global head advances atomically');
SELECT throws_ok($$INSERT INTO public.audit_events(action_type,resource_type,integrity_version) VALUES ('downgrade','test',1)$$,'23514','audit_v2_managed_fields','v1 downgrade rejected by prepared trigger');
SELECT throws_ok($$INSERT INTO public.audit_events(action_type,resource_type,chain_sequence) VALUES ('spoof','test',42)$$,'23514','audit_v2_managed_fields','caller cannot choose sequence');
SELECT throws_ok($$INSERT INTO public.audit_events(action_type,resource_type,event_hash) VALUES ('spoof','test','fake')$$,'23514','audit_v2_managed_fields','caller cannot choose hash');

SELECT throws_ok($query$DO $body$ BEGIN
 INSERT INTO public.audit_events(id,action_type,resource_type) VALUES
 ('14900000-0000-4000-8000-000000000007','before-conflict','test'),
 ('14900000-0000-4000-8000-000000000008','conflict','test'),
 ('14900000-0000-4000-8000-000000000006','after-conflict','test') ON CONFLICT(id) DO NOTHING;
 SET CONSTRAINTS ALL IMMEDIATE;
END; $body$ $query$, '23514','audit_v2_missing_allocated_event','a middle DO NOTHING aborts all allocations, even when the last event exists');
SELECT is((SELECT last_sequence FROM private.audit_chain_heads WHERE scope='global'), 2::bigint,'failed conflict restores head');
SELECT is((SELECT count(*) FROM public.audit_events WHERE action_type IN ('before-conflict','after-conflict')),0::bigint,'failed conflict restores all events');
CREATE FUNCTION pg_temp.skip_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.action_type='skip' THEN RETURN NULL; END IF; RETURN NEW; END$$;
CREATE TRIGGER z_fixture_skip BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.skip_audit_fixture();
SELECT throws_ok($query$DO $body$ BEGIN
 INSERT INTO public.audit_events(action_type,resource_type) VALUES ('skip','test'),('after-skip','test');
 SET CONSTRAINTS ALL IMMEDIATE;
END; $body$ $query$,'23514','audit_v2_missing_allocated_event','later trigger skipping a middle event cannot commit a head');
SELECT is((SELECT last_sequence FROM private.audit_chain_heads WHERE scope='global'),2::bigint,'skipped row restores head');
INSERT INTO public.organizations(id,name) VALUES('14900000-0000-4000-8000-000000000010','Synthetic audit fixture');
INSERT INTO public.audit_events(organization_id,action_type,resource_type)
 VALUES('14900000-0000-4000-8000-000000000010','fixture.org','test');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT ok((SELECT chain_scope='org:14900000-0000-4000-8000-000000000010' AND chain_sequence=1
 AND previous_hash=private.audit_genesis_v2(chain_cutover_id,chain_scope) FROM public.audit_events WHERE action_type='fixture.org'), 'organization has its own sequence and scoped genesis');
-- A different fixed cutover cannot reset an existing scope.
DROP TRIGGER audit_events_chain_insert ON public.audit_events;
CREATE TRIGGER audit_events_chain_insert BEFORE INSERT ON public.audit_events FOR EACH ROW
 EXECUTE FUNCTION private.chain_audit_event_v2('14900000-0000-4000-8000-000000000099');
SELECT throws_ok($$INSERT INTO public.audit_events(action_type,resource_type) VALUES ('new-cutover','test')$$,
 '23514','audit_v2_cutover_mismatch','existing scope cannot restart with another cutover ID');
SELECT * FROM finish();
ROLLBACK;
