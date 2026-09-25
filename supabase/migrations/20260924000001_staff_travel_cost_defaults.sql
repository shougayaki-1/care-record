-- A visit's usual staff reimbursement is configured for each client/staff pair.
-- Keep distance and the organization rate for historical reports; new reports do not use them.
ALTER TABLE public.assignments
  ADD COLUMN default_travel_cost_yen numeric(10,0)
  CONSTRAINT assignments_default_travel_cost_yen_check
  CHECK (default_travel_cost_yen >= 0 AND default_travel_cost_yen <= 100000);

UPDATE public.assignments a
SET default_travel_cost_yen = round(a.round_trip_distance_km * o.travel_cost_rate_yen_per_km)
FROM public.clients c, public.organizations o
WHERE a.client_id = c.id
  AND c.organization_id = o.id
  AND a.round_trip_distance_km > 0
  AND round(a.round_trip_distance_km * o.travel_cost_rate_yen_per_km) <= 100000;

CREATE FUNCTION public.replace_client_assignments_with_costs_authorized(
  p_organization_id uuid,
  p_client_id uuid,
  p_staff_ids uuid[],
  p_costs jsonb
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
  IF jsonb_typeof(COALESCE(p_costs, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_each_text(COALESCE(p_costs, '{}'::jsonb)) item
       WHERE NOT EXISTS (SELECT 1 FROM unnest(v_ids) staff_id WHERE staff_id::text = item.key)
          OR item.value !~ '^[0-9]{1,6}$'
          OR CASE WHEN item.value ~ '^[0-9]{1,6}$' THEN item.value::numeric > 100000 ELSE false END
     ) THEN
    RAISE EXCEPTION 'invalid_costs' USING ERRCODE = '22023';
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
  INSERT INTO public.assignments (client_id, staff_id, helper_id, ghost_staff_id, default_travel_cost_yen)
  SELECT p_client_id, s.id, s.user_id, NULL,
    CASE WHEN p_costs ? s.id::text THEN (p_costs ->> s.id::text)::numeric ELSE NULL END
  FROM public.staffs s
  WHERE s.organization_id = p_organization_id AND s.id = ANY(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_client_assignments_with_costs_authorized(uuid, uuid, uuid[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_client_assignments_with_costs_authorized(uuid, uuid, uuid[], jsonb) TO authenticated;

-- The old rate stays in the table only so past distance-based reports remain interpretable.
CREATE OR REPLACE FUNCTION public.update_organization_setting(p_org_id uuid,p_setting text,p_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_area text;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  v_area:=CASE WHEN p_setting IN ('drive_folder','calendar_disconnect') THEN 'integrations' ELSE 'organization' END;
  IF NOT private.has_management_permission(p_org_id,v_actor,v_area) THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_setting='name' THEN
    IF length(trim(COALESCE(p_value,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_name'; END IF;
    UPDATE public.organizations SET name=trim(p_value) WHERE id=p_org_id AND deleted_at IS NULL;
  ELSIF p_setting='drive_folder' THEN
    IF length(COALESCE(p_value,''))>255 THEN RAISE EXCEPTION 'invalid_folder'; END IF;
    UPDATE public.organizations SET google_folder_id=NULLIF(trim(p_value),'') WHERE id=p_org_id AND deleted_at IS NULL;
  ELSIF p_setting='calendar_disconnect' THEN
    UPDATE public.organizations SET google_calendar_id=NULL,google_refresh_token=NULL,google_connection_status='disconnected',
      google_connection_checked_at=now(),google_connection_error_code=NULL WHERE id=p_org_id AND deleted_at IS NULL;
  ELSE RAISE EXCEPTION 'invalid_setting'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_not_found'; END IF;
END $$;
