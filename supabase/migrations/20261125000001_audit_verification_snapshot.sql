-- Issue #152: freeze the complete verification input in one statement snapshot.
-- Archive runs store derived snapshots; no source audit rows are changed or removed.
-- Verification itself must still validate external control, receipts and v1 evidence;
-- creating or reading this snapshot is never a successful verification verdict.
CREATE FUNCTION public.begin_audit_verification_snapshot() RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10s' AS $$
 WITH run AS (
   INSERT INTO private.audit_archive_runs(id, started_at)
   VALUES (gen_random_uuid(), statement_timestamp()) RETURNING id
 ), frozen AS (
   SELECT 'head'::text AS kind, h.scope, h.last_sequence AS sequence,
     '00000000-0000-0000-0000-000000000000'::uuid AS id,
     jsonb_build_object('kind', 'head', 'scope', h.scope,
       'sequence', h.last_sequence::text, 'hash', h.last_hash, 'cutoverId', h.cutover_id) AS payload
   FROM private.audit_chain_heads h
   UNION ALL
   SELECT CASE WHEN e.integrity_version = 1 THEN 'v1' ELSE 'v2' END,
     COALESCE(e.chain_scope, CASE WHEN e.organization_id IS NULL THEN 'global' ELSE 'org:' || e.organization_id::text END),
     COALESCE(e.chain_sequence, 0), e.id,
     jsonb_build_object('kind', CASE WHEN e.integrity_version = 1 THEN 'v1' ELSE 'v2' END,
       'version', e.integrity_version, 'scope', COALESCE(e.chain_scope,
         CASE WHEN e.organization_id IS NULL THEN 'global' ELSE 'org:' || e.organization_id::text END),
       'sequence', COALESCE(e.chain_sequence, 0)::text, 'id', e.id, 'eventId', e.event_id,
       'hash', e.event_hash, 'previousHash', e.previous_hash, 'cutoverId', e.chain_cutover_id,
       'inventory', replace(encode(private.audit_inventory_bytes(e), 'base64'), E'\n', ''),
       'canonical', CASE WHEN e.integrity_version = 2
         THEN replace(encode(private.audit_canonical_v2(e), 'base64'), E'\n', '') ELSE NULL END)
   FROM public.audit_events e
 ), saved AS (
   INSERT INTO private.audit_archive_items(run_id, kind, scope, sequence, id, payload)
   SELECT run.id, frozen.* FROM run CROSS JOIN frozen RETURNING run_id
 ) SELECT id::text FROM run;
$$;
REVOKE ALL ON FUNCTION public.begin_audit_verification_snapshot() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_audit_verification_snapshot() TO service_role;
