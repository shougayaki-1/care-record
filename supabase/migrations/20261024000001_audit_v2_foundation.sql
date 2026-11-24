-- Issue #149 (A): additive preparation only. Do not change the v1 trigger/default.
-- v2 activation and its externally approved cutover ID belong to #151 (G).
ALTER TABLE public.audit_events
  ADD COLUMN chain_scope text,
  ADD COLUMN chain_sequence bigint,
  ADD COLUMN chain_cutover_id uuid,
  ADD CONSTRAINT audit_events_v2_shape CHECK (
    CASE WHEN integrity_version = 2 THEN
      chain_scope IS NOT NULL AND chain_sequence IS NOT NULL AND chain_sequence > 0
      AND chain_cutover_id IS NOT NULL AND previous_hash IS NOT NULL AND event_hash IS NOT NULL
      AND chain_scope = CASE WHEN organization_id IS NULL THEN 'global' ELSE 'org:' || organization_id::text END
      AND event_hash ~ '^[0-9a-f]{64}$'
    ELSE chain_scope IS NULL AND chain_sequence IS NULL AND chain_cutover_id IS NULL END
  ),
  ADD CONSTRAINT audit_events_scope_sequence_key UNIQUE (chain_scope, chain_sequence);

-- Internal derived state, not a new business permission or independent audit event.
-- No policy: even the auditLogs permission grants no access to chain maintenance.
CREATE TABLE private.audit_chain_heads (
  scope text PRIMARY KEY CHECK (scope = 'global' OR scope ~ '^org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  cutover_id uuid NOT NULL,
  last_sequence bigint NOT NULL CHECK (last_sequence >= 0),
  last_hash text NOT NULL
);
ALTER TABLE private.audit_chain_heads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.audit_chain_heads FROM PUBLIC, anon, authenticated, service_role;

-- Historical v1 bytes intentionally retain session TimeZone/DateStyle semantics.
-- This function does not repair history or infer a predecessor by timestamp order.
CREATE FUNCTION private.audit_canonical_v1(e public.audit_events) RETURNS bytea
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT convert_to(concat_ws('|', e.event_id::text, COALESCE(e.organization_id::text, ''),
   COALESCE(e.actor_id::text, ''), e.action_type, e.resource_type, COALESCE(e.resource_id, ''),
   e.outcome, COALESCE(e.request_id, ''), COALESCE(e.session_id, ''), COALESCE(e.reason, ''),
   e.created_at::text, e.details::text, COALESCE(e.previous_hash, 'GENESIS')), 'UTF8');
$$;

-- PostgreSQL 17 jsonb array text is the byte contract. Sequence is a decimal string.
-- UTC timestamp is fixed to six fractional digits; nulls remain JSON nulls.
CREATE FUNCTION private.audit_canonical_v2(e public.audit_events) RETURNS bytea
LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT convert_to(jsonb_build_array(
   e.integrity_version, e.chain_cutover_id, e.chain_scope, e.chain_sequence::text,
   e.id, e.event_id, e.organization_id, e.actor_id, e.action_type, e.resource_type,
   e.resource_id, e.outcome, e.request_id, e.session_id, e.reason,
   to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   e.details, e.ip_hash, e.user_agent, e.previous_hash)::text, 'UTF8');
$$;

CREATE FUNCTION private.audit_genesis_v2(cutover_id uuid, scope text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
 SELECT 'GENESIS:v2:' || cutover_id::text || ':' || scope;
$$;

-- Prepared but unattached. G must install this INSTEAD OF the v1 BEFORE trigger,
-- passing its approved, fixed cutover UUID as the single trigger argument.
-- Locking and allocation use transactional rows, never nextval(). At RR/Serializable
-- 40001 and at 40P01 the caller must retry the ENTIRE transaction under its existing
-- idempotency contract; this function never retries or sends external effects.
CREATE FUNCTION private.chain_audit_event_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cutover uuid;
  scope_key text;
  head private.audit_chain_heads%ROWTYPE;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'audit_events'
     OR TG_OP <> 'INSERT' OR TG_WHEN <> 'BEFORE' OR TG_NARGS <> 1 THEN
    RAISE EXCEPTION 'audit_v2_invalid_trigger' USING ERRCODE = '23514';
  END IF;
  cutover := TG_ARGV[0]::uuid;
  IF cutover IS NULL OR NEW.integrity_version IS DISTINCT FROM 2
     OR NEW.chain_scope IS NOT NULL OR NEW.chain_sequence IS NOT NULL
     OR NEW.chain_cutover_id IS NOT NULL OR NEW.previous_hash IS NOT NULL OR NEW.event_hash IS NOT NULL THEN
    RAISE EXCEPTION 'audit_v2_managed_fields' USING ERRCODE = '23514';
  END IF;
  scope_key := CASE WHEN NEW.organization_id IS NULL THEN 'global' ELSE 'org:' || NEW.organization_id::text END;
  INSERT INTO private.audit_chain_heads(scope, cutover_id, last_sequence, last_hash)
    VALUES(scope_key, cutover, 0, private.audit_genesis_v2(cutover, scope_key))
    ON CONFLICT (scope) DO NOTHING;
  SELECT * INTO STRICT head FROM private.audit_chain_heads WHERE scope = scope_key FOR UPDATE;
  IF head.cutover_id <> cutover THEN
    RAISE EXCEPTION 'audit_v2_cutover_mismatch' USING ERRCODE = '23514';
  END IF;
  NEW.integrity_version := 2;
  NEW.chain_scope := scope_key;
  NEW.chain_cutover_id := cutover;
  NEW.chain_sequence := head.last_sequence + 1;
  NEW.previous_hash := head.last_hash;
  NEW.event_hash := encode(extensions.digest(private.audit_canonical_v2(NEW), 'sha256'), 'hex');
  UPDATE private.audit_chain_heads SET last_sequence = NEW.chain_sequence, last_hash = NEW.event_hash
    WHERE scope = scope_key;
  RETURN NEW;
END;
$$;

-- Check EVERY allocation, not just the final head: a skipped middle INSERT must
-- abort even if a later row succeeds. NEW captures each intermediate head value.
CREATE FUNCTION private.check_audit_head_event_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.last_sequence = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.audit_events e WHERE e.chain_scope = NEW.scope
        AND e.chain_cutover_id = NEW.cutover_id AND e.chain_sequence = 1
        AND e.previous_hash = private.audit_genesis_v2(NEW.cutover_id, NEW.scope)) THEN
      RAISE EXCEPTION 'audit_v2_missing_genesis_event' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.audit_events e WHERE e.chain_scope = NEW.scope
      AND e.chain_cutover_id = NEW.cutover_id AND e.chain_sequence = NEW.last_sequence
      AND e.integrity_version = 2 AND e.event_hash = NEW.last_hash
      AND e.event_hash = encode(extensions.digest(private.audit_canonical_v2(e), 'sha256'), 'hex')
      AND e.previous_hash = CASE WHEN NEW.last_sequence = 1
        THEN private.audit_genesis_v2(NEW.cutover_id, NEW.scope)
        ELSE (SELECT p.event_hash FROM public.audit_events p WHERE p.chain_scope = NEW.scope
          AND p.chain_cutover_id = NEW.cutover_id AND p.chain_sequence = NEW.last_sequence - 1) END
  ) THEN
    RAISE EXCEPTION 'audit_v2_missing_allocated_event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER audit_head_event_v2
  AFTER INSERT OR UPDATE ON private.audit_chain_heads
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION private.check_audit_head_event_v2();

-- Reject fabricated/unallocated v2 rows even while the original v1 trigger is
-- still installed. This deferred check has no effect on historical/v1 INSERTs.
CREATE FUNCTION private.check_audit_event_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.audit_chain_heads h
      WHERE h.scope = NEW.chain_scope AND h.cutover_id = NEW.chain_cutover_id
        AND h.last_sequence >= NEW.chain_sequence)
     OR NEW.event_hash IS DISTINCT FROM encode(extensions.digest(private.audit_canonical_v2(NEW), 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'audit_v2_unallocated_event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER audit_event_allocation_v2
  AFTER INSERT ON public.audit_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.integrity_version = 2)
  EXECUTE FUNCTION private.check_audit_event_v2();

REVOKE ALL ON FUNCTION private.audit_canonical_v1(public.audit_events) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.audit_canonical_v2(public.audit_events) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.audit_genesis_v2(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.chain_audit_event_v2() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.check_audit_head_event_v2() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.check_audit_event_v2() FROM PUBLIC, anon, authenticated, service_role;
