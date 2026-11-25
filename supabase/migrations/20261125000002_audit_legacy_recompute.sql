-- Bounded v1 recomputation for a previously frozen verification snapshot.
-- The caller must first validate external evidence for the chosen settings.
-- This RPC does not decide whether any historical event is trustworthy.
CREATE FUNCTION public.recompute_audit_v1_snapshot(
  p_run uuid, p_ids uuid[], p_timezone text, p_datestyle text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10s' AS $$
DECLARE
  old_timezone text := current_setting('TimeZone');
  old_datestyle text := current_setting('DateStyle');
  output jsonb;
  matches_snapshot boolean;
BEGIN
  IF p_run IS NULL OR COALESCE(cardinality(p_ids), 0) NOT BETWEEN 1 AND 100
     OR cardinality(p_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x)
     OR p_timezone IS NULL OR length(p_timezone) NOT BETWEEN 1 AND 128
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone)
     OR p_datestyle IS NULL OR p_datestyle !~ '^(ISO|SQL|Postgres|German), (MDY|DMY|YMD)$' THEN
    RAISE EXCEPTION 'audit_recompute_invalid';
  END IF;
  PERFORM set_config('TimeZone', p_timezone, true);
  PERFORM set_config('DateStyle', p_datestyle, true);
  -- Comparison and hash calculation must share one statement snapshot. Two
  -- separate SELECTs could see different source rows under READ COMMITTED.
  SELECT count(*) = cardinality(p_ids) AND bool_and(COALESCE(frozen.id IS NOT NULL AND event.id IS NOT NULL
      AND private.audit_inventory_bytes(event) = decode(frozen.payload->>'inventory', 'base64'), false)),
    jsonb_agg(jsonb_build_object('id', requested.id,
      'hash', CASE WHEN frozen.id IS NOT NULL AND event.id IS NOT NULL
        AND private.audit_inventory_bytes(event) = decode(frozen.payload->>'inventory', 'base64')
        THEN encode(extensions.digest(private.audit_canonical_v1(event), 'sha256'), 'hex') ELSE NULL END)
      ORDER BY requested.ordinality)
  INTO matches_snapshot, output
  FROM unnest(p_ids) WITH ORDINALITY requested(id, ordinality)
  LEFT JOIN private.audit_archive_items frozen ON frozen.run_id = p_run AND frozen.kind = 'v1' AND frozen.id = requested.id
  LEFT JOIN public.audit_events event ON event.id = requested.id AND event.integrity_version = 1;
  IF matches_snapshot IS DISTINCT FROM true THEN RAISE EXCEPTION 'audit_recompute_snapshot_mismatch'; END IF;
  PERFORM set_config('TimeZone', old_timezone, true);
  PERFORM set_config('DateStyle', old_datestyle, true);
  RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION public.recompute_audit_v1_snapshot(uuid, uuid[], text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_audit_v1_snapshot(uuid, uuid[], text, text) TO service_role;
