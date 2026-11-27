-- A retry of the same verification request must reuse its frozen snapshot.
-- This does not remove snapshots or limit growth from distinct requests.
CREATE TABLE private.audit_verification_requests (
  request_id uuid PRIMARY KEY,
  context_digest text NOT NULL CHECK (context_digest ~ '^[0-9a-f]{64}$'),
  run_id uuid NOT NULL UNIQUE REFERENCES private.audit_archive_runs(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE private.audit_verification_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.audit_verification_requests FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER audit_verification_request_no_mutation
  BEFORE UPDATE OR DELETE ON private.audit_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();

CREATE FUNCTION public.begin_audit_verification_request(p_request_id uuid, p_context_digest text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10s' AS $$
DECLARE existing private.audit_verification_requests%ROWTYPE; result uuid;
BEGIN
  IF p_request_id IS NULL OR p_context_digest IS NULL OR p_context_digest !~ '^[0-9a-f]{64}$'
     OR current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'audit_verification_request_invalid';
  END IF;
  -- The transaction-scoped lock makes the subsequent SELECT see the winning
  -- committed request in READ COMMITTED. A failed transaction leaves no claim.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('audit-verification-request:' || p_request_id::text, 0));
  SELECT * INTO existing FROM private.audit_verification_requests WHERE request_id = p_request_id;
  IF FOUND THEN
    IF existing.context_digest <> p_context_digest THEN RAISE EXCEPTION 'audit_verification_request_conflict'; END IF;
    RETURN existing.run_id::text;
  END IF;
  result := public.begin_audit_verification_snapshot()::uuid;
  INSERT INTO private.audit_verification_requests(request_id,context_digest,run_id)
    VALUES (p_request_id,p_context_digest,result);
  RETURN result::text;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_audit_verification_request(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_audit_verification_request(uuid, text) TO service_role;
