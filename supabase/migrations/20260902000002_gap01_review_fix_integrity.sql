-- GAP-01 independent-audit review fixes.
--
-- Keep ordinary shifts SELECT RLS unchanged.  The two narrowly-scoped
-- SECURITY DEFINER contracts below are the only path that exposes deleted
-- rows: one only enumerates pending Google deletion work, and the other
-- atomically classifies a caller-provided same-organization delete chunk.

CREATE OR REPLACE FUNCTION public.list_deleted_shift_google_sync_targets(
  p_org_id uuid,
  p_cursor uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
) RETURNS TABLE (
  shift_id uuid,
  google_sync_status text,
  next_cursor uuid,
  remaining bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_scope text;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  v_scope := private.get_member_shift_action_scope(p_org_id, auth.uid(), 'edit');
  IF v_scope <> 'all'
     AND private.get_member_shift_action_scope(p_org_id, auth.uid(), 'delete') <> 'all' THEN
    RAISE EXCEPTION 'shift sync permission required';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'invalid sync target limit';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT s.id, s.google_sync_status
    FROM public.shifts s
    WHERE s.organization_id = p_org_id
      AND s.deleted_at IS NOT NULL
      AND s.google_sync_status IN ('pending_delete', 'failed')
      AND (p_cursor IS NULL OR s.id > p_cursor)
    ORDER BY s.id
  ), page AS (
    SELECT * FROM candidates LIMIT p_limit
  ), page_meta AS (
    SELECT max(id) AS cursor, count(*)::bigint AS selected FROM page
  )
  SELECT
    page.id,
    page.google_sync_status,
    page_meta.cursor,
    GREATEST((SELECT count(*)::bigint FROM candidates) - page_meta.selected, 0)
  FROM page
  CROSS JOIN page_meta
  ORDER BY page.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_shifts_checked(
  p_org_id uuid,
  p_shift_ids uuid[],
  p_reason text,
  p_retention_until timestamptz,
  p_sync_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_requested integer;
  v_matched integer;
  v_active integer;
  v_already_deleted integer;
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'delete') <> 'all' THEN
    RAISE EXCEPTION 'shift delete permission required';
  END IF;
  IF p_shift_ids IS NULL OR cardinality(p_shift_ids) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_shift_ids) AS requested(id) WHERE id IS NULL) THEN
    RAISE EXCEPTION 'invalid shift delete targets';
  END IF;
  IF p_sync_status NOT IN ('synced', 'pending_delete') THEN
    RAISE EXCEPTION 'invalid sync status';
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_ids
  FROM (SELECT DISTINCT id FROM unnest(p_shift_ids) AS requested(id)) AS deduplicated;
  v_requested := cardinality(v_ids);

  -- Lock in the same stable order used for classification.  Every requested
  -- ID must be a row in this organization; a foreign or absent ID aborts the
  -- entire chunk before any UPDATE can occur.
  PERFORM 1
  FROM public.shifts s
  WHERE s.organization_id = p_org_id AND s.id = ANY(v_ids)
  ORDER BY s.id
  FOR UPDATE;
  GET DIAGNOSTICS v_matched = ROW_COUNT;
  IF v_matched <> v_requested THEN
    RAISE EXCEPTION 'shift delete targets not found or outside organization';
  END IF;

  SELECT
    count(*) FILTER (WHERE s.deleted_at IS NULL)::integer,
    count(*) FILTER (WHERE s.deleted_at IS NOT NULL)::integer
  INTO v_active, v_already_deleted
  FROM public.shifts s
  WHERE s.organization_id = p_org_id AND s.id = ANY(v_ids);

  UPDATE public.shifts
  SET deleted_at = now(),
      deleted_by = auth.uid(),
      deletion_reason = p_reason,
      retention_until = p_retention_until,
      google_sync_status = p_sync_status,
      google_sync_error = NULL,
      google_synced_at = CASE WHEN p_sync_status = 'synced' THEN now() ELSE NULL END
  WHERE organization_id = p_org_id
    AND id = ANY(v_ids)
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_active THEN
    RAISE EXCEPTION 'shift delete row count mismatch';
  END IF;

  RETURN jsonb_build_object(
    'requested', v_requested,
    'matched', v_matched,
    'deleted', v_deleted,
    'already_deleted', v_already_deleted,
    'failed', 0
  );
END;
$$;

-- Preserve the legacy integer-returning RPC signature for callers that have
-- not yet migrated.  Its semantics are now the checked, idempotent contract.
CREATE OR REPLACE FUNCTION public.soft_delete_shifts_atomic(
  p_org_id uuid,
  p_shift_ids uuid[],
  p_reason text,
  p_retention_until timestamptz,
  p_sync_status text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.soft_delete_shifts_checked(
    p_org_id, p_shift_ids, p_reason, p_retention_until, p_sync_status
  );
  RETURN (v_result->>'deleted')::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_shift_with_segments_atomic(
  p_org_id uuid,
  p_shift_id uuid,
  p_payload jsonb,
  p_replace_segments boolean DEFAULT false,
  p_segments jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_at timestamptz;
  v_outcome text;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF private.get_member_shift_action_scope(p_org_id, auth.uid(), 'edit') <> 'all' THEN
    RAISE EXCEPTION 'shift edit permission required';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid shift update payload';
  END IF;
  IF p_replace_segments IS NULL THEN
    RAISE EXCEPTION 'invalid segment replacement flag';
  END IF;

  SELECT s.deleted_at INTO v_deleted_at
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.organization_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RETURN 'deleted';
  END IF;

  -- Omitted segments preserve the current set.  A supplied empty array is a
  -- deliberate replacement; JSON null and non-arrays are rejected.
  IF p_replace_segments THEN
    IF p_segments IS NULL OR jsonb_typeof(p_segments) <> 'array' THEN
      RAISE EXCEPTION 'segments must be an array';
    END IF;
    PERFORM public.replace_shift_segments(p_org_id, p_shift_id, p_segments);
  END IF;

  -- Do not trust a client-provided denormalized title.  The final title is
  -- rebuilt from the committed client and derived shift_staffs state below.
  v_outcome := public.update_shift_fields_atomic(
    p_org_id,
    p_shift_id,
    p_payload - 'title'
  );
  IF v_outcome <> 'updated' THEN
    RAISE EXCEPTION 'shift field update did not complete: %', v_outcome;
  END IF;
  PERFORM public.refresh_shift_title(p_shift_id);
  RETURN 'updated';
END;
$$;

REVOKE ALL ON FUNCTION public.list_deleted_shift_google_sync_targets(uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_shifts_checked(uuid,uuid[],text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_shifts_atomic(uuid,uuid[],text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_shift_with_segments_atomic(uuid,uuid,jsonb,boolean,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_deleted_shift_google_sync_targets(uuid,uuid,integer) FROM anon;
REVOKE ALL ON FUNCTION public.soft_delete_shifts_checked(uuid,uuid[],text,timestamptz,text) FROM anon;
REVOKE ALL ON FUNCTION public.soft_delete_shifts_atomic(uuid,uuid[],text,timestamptz,text) FROM anon;
REVOKE ALL ON FUNCTION public.update_shift_with_segments_atomic(uuid,uuid,jsonb,boolean,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_deleted_shift_google_sync_targets(uuid,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_shifts_checked(uuid,uuid[],text,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_shifts_atomic(uuid,uuid[],text,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shift_with_segments_atomic(uuid,uuid,jsonb,boolean,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
