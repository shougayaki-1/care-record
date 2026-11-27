-- Verification-only page reader. Keep the existing archive reader unchanged.
-- The size calculation matches jsonb's UTF-8 text representation, while the
-- final array is materialized only once rather than once per candidate row.
CREATE OR REPLACE FUNCTION public.read_audit_verification_snapshot(p_run uuid, p_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10s' AS $$
DECLARE
  item record;
  items jsonb[] := ARRAY[]::jsonb[];
  item_count integer := 0;
  payload_bytes bigint := 0;
  cursor_value jsonb := p_cursor;
  candidate jsonb;
  candidate_bytes bigint;
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
    candidate_bytes := octet_length(convert_to(jsonb_build_object('items', '[]'::jsonb,
      'cursor', candidate, 'more', true)::text, 'UTF8'))
      + payload_bytes + CASE WHEN item_count > 0 THEN 2 ELSE 0 END
      + octet_length(convert_to(item.payload::text, 'UTF8'));
    -- A final page writes `false`, one byte longer than candidate `true`.
    IF item_count = 500 OR candidate_bytes > 524287 THEN
      IF item_count = 0 THEN RAISE EXCEPTION 'archive_row_too_large'; END IF;
      more := true;
      EXIT;
    END IF;
    payload_bytes := payload_bytes + CASE WHEN item_count > 0 THEN 2 ELSE 0 END
      + octet_length(convert_to(item.payload::text, 'UTF8'));
    items := array_append(items, item.payload);
    item_count := item_count + 1;
    cursor_value := candidate;
  END LOOP;
  result := jsonb_build_object('items', to_jsonb(items), 'cursor', cursor_value, 'more', more);
  -- Defence in depth in case JSONB formatting ever changes in a DB upgrade.
  IF octet_length(convert_to(result::text, 'UTF8')) > 524288 THEN
    RAISE EXCEPTION 'archive_page_too_large';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_audit_verification_snapshot(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_audit_verification_snapshot(uuid, jsonb) TO service_role;
