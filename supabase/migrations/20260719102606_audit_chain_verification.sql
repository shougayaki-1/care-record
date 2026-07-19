-- Weekly-verification RPC for the audit_events hash chain built by
-- private.chain_audit_event() (see 20260630235959_init.sql). Recomputes the
-- exact same canonicalization/SHA-256 formula in SQL (not JS) so timestamp
-- and JSONB text-representation differences never produce false positives.

CREATE OR REPLACE FUNCTION "public"."verify_audit_chain"()
RETURNS TABLE("organization_id" "uuid", "event_id" "uuid", "id" "uuid", "mismatch_type" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  WITH ordered AS (
    SELECT
      ae.id,
      ae.event_id,
      ae.organization_id,
      ae.previous_hash,
      ae.event_hash,
      lag(ae.event_hash) OVER (
        PARTITION BY ae.organization_id ORDER BY ae.created_at, ae.id
      ) AS expected_previous_hash,
      encode(
        extensions.digest(
          convert_to(
            concat_ws('|',
              ae.event_id::text,
              COALESCE(ae.organization_id::text, ''),
              COALESCE(ae.actor_id::text, ''),
              ae.action_type,
              ae.resource_type,
              COALESCE(ae.resource_id, ''),
              ae.outcome,
              COALESCE(ae.request_id, ''),
              COALESCE(ae.session_id, ''),
              COALESCE(ae.reason, ''),
              ae.created_at::text,
              ae.details::text,
              COALESCE(
                lag(ae.event_hash) OVER (
                  PARTITION BY ae.organization_id ORDER BY ae.created_at, ae.id
                ),
                'GENESIS'
              )
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) AS expected_event_hash
    FROM public.audit_events ae
    WHERE ae.event_hash IS NOT NULL
  )
  SELECT o.organization_id, o.event_id, o.id,
    CASE
      WHEN o.event_hash IS DISTINCT FROM o.expected_event_hash THEN 'hash_mismatch'
      ELSE 'chain_break'
    END AS mismatch_type
  FROM ordered o
  WHERE o.event_hash IS DISTINCT FROM o.expected_event_hash
     OR o.previous_hash IS DISTINCT FROM o.expected_previous_hash;
$$;

ALTER FUNCTION "public"."verify_audit_chain"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."verify_audit_chain"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."verify_audit_chain"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."verify_audit_chain"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."verify_audit_chain"() TO "service_role";
