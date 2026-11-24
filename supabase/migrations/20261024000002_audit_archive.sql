-- #150 depends on #149's additive foundation. No trigger/default activation.
-- Derived preservation snapshots: no business permission grants access. Retain
-- snapshots (no automatic DELETE); capacity must be measured before deployment.
CREATE TABLE private.audit_archive_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE private.audit_archive_items (
  run_id uuid NOT NULL REFERENCES private.audit_archive_runs(id),
  kind text NOT NULL CHECK (kind IN ('head', 'v1', 'v2')),
  scope text NOT NULL,
  sequence bigint NOT NULL,
  id uuid NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (run_id, kind, scope, sequence, id)
);
CREATE TABLE private.audit_archive_progress (
  destination text PRIMARY KEY,
  ordinal text NOT NULL CHECK (ordinal ~ '^[1-9][0-9]*$'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.audit_archive_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.audit_archive_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.audit_archive_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.audit_archive_runs, private.audit_archive_items, private.audit_archive_progress
  FROM PUBLIC, anon, authenticated, service_role;

-- Inventory v1: fixed order, all historical columns, plus nullable A columns.
-- Hash bytes are independent of v1's historically variable TimeZone/DateStyle.
-- Schema 1 export reconciliation must use only the original 18 columns.
CREATE FUNCTION private.audit_inventory_bytes(e public.audit_events) RETURNS bytea
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT convert_to(jsonb_build_array('audit-inventory:2', e.id, e.event_id,
   e.organization_id, e.actor_id, e.action_type, e.resource_type, e.resource_id,
   e.outcome, e.request_id, e.session_id, e.reason,
   to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   e.details, e.ip_hash, e.user_agent, e.previous_hash, e.event_hash,
   e.integrity_version, e.chain_scope, e.chain_sequence::text, e.chain_cutover_id)::text, 'UTF8');
$$;

CREATE FUNCTION public.begin_audit_archive(p_positions jsonb DEFAULT '{}'::jsonb, p_include_v1 boolean DEFAULT true) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10s' AS $$
 WITH run AS (
   INSERT INTO private.audit_archive_runs SELECT gen_random_uuid(), statement_timestamp()
   WHERE jsonb_typeof(p_positions) = 'object' AND octet_length(p_positions::text) <= 524288
   RETURNING id
 ), frozen AS (
   -- Both SELECTs execute in the SAME statement snapshot, including all scopes.
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
   WHERE (p_include_v1 AND e.integrity_version = 1)
     OR (NOT p_include_v1 AND e.integrity_version <> 1
       AND COALESCE(e.chain_sequence, 0) > COALESCE((p_positions->>e.chain_scope)::bigint, 0))
 ), saved AS (
   INSERT INTO private.audit_archive_items(run_id, kind, scope, sequence, id, payload)
   SELECT run.id, frozen.* FROM run CROSS JOIN frozen RETURNING run_id
 ) SELECT id::text FROM run;
$$;

-- Cursor is based ONLY on the last returned item. Bigints travel as decimal text.
-- Conservative 512 KiB JSONB text bound leaves room for the complete HTTP JSON
-- response (PostgREST serializes JSONB directly, not a quoted JSON string).
CREATE FUNCTION public.read_audit_archive(p_run uuid, p_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10s' AS $$
DECLARE
  item record;
  rows jsonb := '[]';
  cursor_value jsonb := p_cursor;
  candidate jsonb;
  result jsonb;
  more boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.audit_archive_runs WHERE id = p_run) THEN
    RAISE EXCEPTION 'archive_run_missing';
  END IF;
  IF p_cursor IS NOT NULL AND (jsonb_typeof(p_cursor) <> 'array' OR jsonb_array_length(p_cursor) <> 4
     OR p_cursor->>0 NOT IN ('head', 'v1', 'v2') OR p_cursor->>2 !~ '^(0|[1-9][0-9]*)$') THEN
    RAISE EXCEPTION 'archive_cursor_invalid';
  END IF;
  FOR item IN SELECT * FROM private.audit_archive_items
    WHERE run_id = p_run AND (p_cursor IS NULL OR (kind, scope, sequence, id) >
      (p_cursor->>0, p_cursor->>1, (p_cursor->>2)::bigint, (p_cursor->>3)::uuid))
    ORDER BY kind, scope, sequence, id LIMIT 501
  LOOP
    candidate := jsonb_build_array(item.kind, item.scope, item.sequence::text, item.id);
    result := jsonb_build_object('items', rows || jsonb_build_array(item.payload), 'cursor', candidate, 'more', true);
    IF jsonb_array_length(rows) = 500 OR octet_length(convert_to(result::text, 'UTF8')) > 524288 THEN
      IF jsonb_array_length(rows) = 0 THEN RAISE EXCEPTION 'archive_row_too_large'; END IF;
      more := true;
      EXIT;
    END IF;
    rows := rows || jsonb_build_array(item.payload);
    cursor_value := candidate;
  END LOOP;
  RETURN jsonb_build_object('items', rows, 'cursor', cursor_value, 'more', more);
END;
$$;

-- A cache, never used to choose an external ordinal or a DB read lower bound.
CREATE FUNCTION public.cache_audit_archive(p_destination text, p_ordinal text, p_digest text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 INSERT INTO private.audit_archive_progress(destination, ordinal, manifest_digest)
 VALUES (p_destination, p_ordinal, p_digest)
 ON CONFLICT (destination) DO UPDATE SET ordinal = EXCLUDED.ordinal,
   manifest_digest = EXCLUDED.manifest_digest, updated_at = now()
 WHERE length(EXCLUDED.ordinal) > length(private.audit_archive_progress.ordinal)
   OR (length(EXCLUDED.ordinal) = length(private.audit_archive_progress.ordinal)
       AND EXCLUDED.ordinal >= private.audit_archive_progress.ordinal);
$$;
REVOKE ALL ON FUNCTION private.audit_inventory_bytes(public.audit_events) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.begin_audit_archive(jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_audit_archive(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cache_audit_archive(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_audit_archive(jsonb, boolean), public.read_audit_archive(uuid, jsonb),
 public.cache_audit_archive(text, text, text) TO service_role;
