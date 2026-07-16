-- Move client/staff business mutations from the service role to the caller's
-- authenticated JWT. Every privileged operation checks auth.uid(), membership,
-- organization ownership and the flexible management permission inside the DB.

GRANT INSERT, UPDATE ON TABLE public.clients TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.staffs TO authenticated;
GRANT INSERT, DELETE ON TABLE public.staff_position_presets TO authenticated;

DROP POLICY IF EXISTS "Staff managers insert position presets" ON public.staff_position_presets;
CREATE POLICY "Staff managers insert position presets" ON public.staff_position_presets
  FOR INSERT TO authenticated
  WITH CHECK (private.has_management_permission(organization_id, auth.uid(), 'staffs'));

DROP POLICY IF EXISTS "Staff managers delete position presets" ON public.staff_position_presets;
CREATE POLICY "Staff managers delete position presets" ON public.staff_position_presets
  FOR DELETE TO authenticated
  USING (private.has_management_permission(organization_id, auth.uid(), 'staffs'));

-- The initial schema included broad authenticated SELECT policies. Restrictive
-- tenant-boundary policies ensure those policies can never reveal another org.
DROP POLICY IF EXISTS "Client select organization boundary" ON public.clients;
CREATE POLICY "Client select organization boundary" ON public.clients
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.can_access_client(id));

DROP POLICY IF EXISTS "Staff select organization boundary" ON public.staffs;
CREATE POLICY "Staff select organization boundary" ON public.staffs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

DROP POLICY IF EXISTS "Assignment select organization boundary" ON public.assignments;
CREATE POLICY "Assignment select organization boundary" ON public.assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.can_access_client(client_id));

DROP POLICY IF EXISTS "Client form select organization boundary" ON public.form_templates;
CREATE POLICY "Client form select organization boundary" ON public.form_templates
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.can_access_client(client_id));

CREATE OR REPLACE FUNCTION public.upsert_client_form_authorized(
  p_organization_id uuid,
  p_client_id uuid,
  p_schema jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT private.is_org_member(p_organization_id)
     OR NOT private.has_management_permission(p_organization_id, auth.uid(), 'clients') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_schema) <> 'array'
     OR jsonb_array_length(p_schema) > 200
     OR octet_length(p_schema::text) > 1000000 THEN
    RAISE EXCEPTION 'invalid_form_schema' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_client_id AND c.organization_id = p_organization_id AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'client_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Serialize updates for a client so concurrent first writes cannot duplicate a template.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text, 0));
  UPDATE public.form_templates
  SET schema = p_schema, updated_at = timezone('utc', now())
  WHERE client_id = p_client_id;
  IF NOT FOUND THEN
    INSERT INTO public.form_templates (client_id, schema) VALUES (p_client_id, p_schema);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_client_assignments_authorized(
  p_organization_id uuid,
  p_client_id uuid,
  p_staff_ids uuid[],
  p_distances jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[] := COALESCE(p_staff_ids, ARRAY[]::uuid[]);
BEGIN
  IF auth.uid() IS NULL
     OR NOT private.is_org_member(p_organization_id)
     OR NOT private.has_management_permission(p_organization_id, auth.uid(), 'clients') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF cardinality(v_ids) > 200
     OR cardinality(v_ids) <> (SELECT count(DISTINCT value)::integer FROM unnest(v_ids) value) THEN
    RAISE EXCEPTION 'invalid_staff_ids' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_distances, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_distances' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_client_id AND c.organization_id = p_organization_id AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'client_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM public.staffs s
      WHERE s.organization_id = p_organization_id
        AND s.id = ANY(v_ids) AND s.archived_at IS NULL AND s.deleted_at IS NULL) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'invalid_staff_ids' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.assignments a WHERE a.client_id = p_client_id;
  INSERT INTO public.assignments (
    client_id, staff_id, helper_id, ghost_staff_id, round_trip_distance_km
  )
  SELECT
    p_client_id,
    s.id,
    s.user_id,
    NULL,
    LEAST(GREATEST(COALESCE((p_distances ->> s.id::text)::numeric, 0), 0), 1000)
  FROM public.staffs s
  WHERE s.organization_id = p_organization_id AND s.id = ANY(v_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_staffs_authorized(
  p_organization_id uuid,
  p_staff_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[] := COALESCE(p_staff_ids, ARRAY[]::uuid[]);
BEGIN
  IF auth.uid() IS NULL
     OR NOT private.is_org_member(p_organization_id)
     OR NOT private.has_management_permission(p_organization_id, auth.uid(), 'staffs') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF cardinality(v_ids) > 500
     OR cardinality(v_ids) <> (SELECT count(DISTINCT value)::integer FROM unnest(v_ids) value)
     OR (SELECT count(*) FROM public.staffs s
         WHERE s.organization_id = p_organization_id
           AND s.id = ANY(v_ids) AND s.deleted_at IS NULL) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'invalid_staff_ids' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staffs s
  SET sort_order = ordered.ordinality - 1
  FROM unnest(v_ids) WITH ORDINALITY AS ordered(id, ordinality)
  WHERE s.id = ordered.id AND s.organization_id = p_organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_client_assignment_permission_hints_authorized(
  p_organization_id uuid,
  p_client_id uuid
) RETURNS TABLE (
  staff_id uuid,
  user_id uuid,
  can_create_all_records boolean,
  role_names text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT private.is_org_member(p_organization_id)
     OR NOT private.has_management_permission(p_organization_id, auth.uid(), 'clients') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_client_id AND c.organization_id = p_organization_id AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'client_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    COALESCE(om.role = 'owner', false)
      OR COALESCE(bool_or((r.permissions -> 'records' ->> 'create') = 'all'), false),
    COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), ARRAY[]::text[])
  FROM public.staffs s
  LEFT JOIN public.organization_members om
    ON om.organization_id = s.organization_id AND om.user_id = s.user_id
  LEFT JOIN public.organization_member_roles omr
    ON omr.organization_id = s.organization_id AND omr.user_id = s.user_id
  LEFT JOIN public.organization_roles r ON r.id = omr.role_id
  WHERE s.organization_id = p_organization_id
    AND s.user_id IS NOT NULL
    AND s.deleted_at IS NULL
  GROUP BY s.id, s.user_id, om.role;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_client_form_authorized(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_client_assignments_authorized(uuid, uuid, uuid[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_staffs_authorized(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_client_assignment_permission_hints_authorized(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_client_form_authorized(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_client_assignments_authorized(uuid, uuid, uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_staffs_authorized(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_assignment_permission_hints_authorized(uuid, uuid) TO authenticated;
