-- #150: explicit jsonb initialization passes plpgsql_check without weakening CI.
-- Keep the previous migration immutable; function contract/ACL are unchanged.
CREATE OR REPLACE FUNCTION public.read_audit_archive(p_run uuid, p_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '10s' AS $$
DECLARE
  item record;
  rows jsonb := '[]'::jsonb;
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

REVOKE ALL ON FUNCTION public.read_audit_archive(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_audit_archive(uuid, jsonb) TO service_role;
