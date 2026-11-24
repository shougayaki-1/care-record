BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(18);
SELECT ok(NOT has_table_privilege('care_security_monitor','public.login_attempts','SELECT'), 'monitor cannot read hashes or user agents');
SELECT ok(NOT has_table_privilege('care_security_monitor','public.audit_events','SELECT'), 'monitor cannot read tenants or audit details');
SELECT ok(NOT has_table_privilege('care_security_monitor','private.security_monitor_state','UPDATE'), 'state requires CAS function');
SELECT ok(NOT has_function_privilege('anon','private.security_monitor_snapshot()','EXECUTE'), 'anonymous cannot aggregate');
SELECT ok(NOT has_function_privilege('authenticated','private.security_monitor_snapshot()','EXECUTE'), 'tenant users cannot aggregate');
SELECT ok(NOT has_function_privilege('service_role','private.security_monitor_snapshot()','EXECUTE'), 'service role is not used');
SELECT ok(NOT has_function_privilege('authenticated','private.security_monitor_save(bigint,jsonb)','EXECUTE'), 'tenant users cannot forge state');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.security_monitor_state'::regclass), 'state has RLS and no business policy');
SELECT ok((SELECT NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname='care_security_monitor'), 'monitor role has no login or RLS bypass');
INSERT INTO public.login_attempts (ip_hash,email_hash,outcome,created_at,user_agent)
SELECT 'synthetic-ip', 'synthetic-email-'||n, 'failure', now()-interval '2 minutes', 'SECRET-AGENT' FROM generate_series(1,20) n;
INSERT INTO public.login_attempts (ip_hash,email_hash,outcome,created_at)
SELECT 'synthetic-ip-'||n, 'synthetic-target', 'failure', now()-interval '2 minutes' FROM generate_series(1,5) n;
INSERT INTO public.login_attempts (ip_hash,email_hash,outcome,created_at)
VALUES ('synthetic-ip','synthetic-target','success', now()-interval '1 minute'), (NULL,NULL,'failure',now()-interval '1 minute');
SELECT is((private.security_monitor_snapshot()->'metrics'->>'failures_5m')::int,26,'5m failures counted');
SELECT is((private.security_monitor_snapshot()->'metrics'->>'spray_sources_15m')::int,1,'one IP targeting multiple accounts');
SELECT is((private.security_monitor_snapshot()->'metrics'->>'distributed_targets_15m')::int,1,'multiple IPs targeting one account');
SELECT is((private.security_monitor_snapshot()->'metrics'->>'success_after_failures_15m')::int,1,'success after prior failures');
SELECT is((private.security_monitor_snapshot()->'metrics'->>'missing_hashes_15m')::int,1,'hash gap counted');
SELECT ok(private.security_monitor_snapshot()::text !~ 'synthetic-|SECRET-AGENT', 'snapshot excludes identifiers and arbitrary details');
-- Disposable, transaction-scoped membership; production LOGIN provisioning is external.
GRANT care_security_monitor TO postgres;
GRANT USAGE ON SCHEMA extensions TO care_security_monitor;
SET LOCAL ROLE care_security_monitor;
SELECT lives_ok('SELECT private.security_monitor_snapshot()', 'restricted role can read counts');
SELECT lives_ok($$SELECT private.security_monitor_save(0,'{"last_observed":"2026-10-26T00:00:00Z"}')$$, 'restricted role can CAS state');
SELECT throws_ok($$SELECT private.security_monitor_save(0,'{}')$$, 'P0001', 'security_monitor_state_conflict', 'stale writer rejected');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
