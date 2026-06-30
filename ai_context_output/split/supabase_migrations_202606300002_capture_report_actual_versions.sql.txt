-- Save report actual service/staffing inside the atomic report RPC.
-- The prior app flow saved reports first, then updated actuals with the
-- service-role client. If the second step failed, users saw an error even
-- though the report body had already been persisted.

CREATE OR REPLACE FUNCTION private.capture_complete_report_version(
  p_report_id uuid,
  p_actor_id uuid,
  p_change_reason text,
  p_session_id text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_org_id uuid;
  next_version bigint;
  prior text;
  snap jsonb;
  snap_hash text;
  confirmer uuid;
BEGIN
  SELECT c.organization_id, r.approved_by,
         jsonb_build_object(
           'report', to_jsonb(r),
           'report_values', COALESCE(rv.data, '{}'::jsonb),
           'report_actual_staffs', COALESCE(
             (
               SELECT jsonb_agg(to_jsonb(ras) ORDER BY ras.sort_order, ras.created_at)
                 FROM public.report_actual_staffs ras
                WHERE ras.report_id = r.id
             ),
             '[]'::jsonb
           )
         )
    INTO target_org_id, confirmer, snap
    FROM public.reports r
    JOIN public.clients c ON c.id = r.client_id
    LEFT JOIN public.report_values rv ON rv.report_id = r.id
   WHERE r.id = p_report_id;
  IF target_org_id IS NULL THEN RAISE EXCEPTION 'report_not_found'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('report-version:' || p_report_id::text, 0));
  SELECT rv.version_number, rv.snapshot_hash INTO next_version, prior
    FROM public.record_versions rv
   WHERE rv.resource_type = 'report' AND rv.resource_id = p_report_id
   ORDER BY rv.version_number DESC LIMIT 1;
  next_version := COALESCE(next_version, 0) + 1;
  snap_hash := encode(extensions.digest(convert_to(COALESCE(prior, 'GENESIS') || snap::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.record_versions(
    organization_id, resource_type, resource_id, version_number, snapshot,
    actor_id, confirmed_by, change_reason, session_id, previous_hash, snapshot_hash
  ) VALUES (
    target_org_id, 'report', p_report_id, next_version, snap,
    p_actor_id, confirmer, p_change_reason, p_session_id, prior, snap_hash
  );
  RETURN next_version;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_complete_report_version(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
