-- PostgREST cannot expose overloaded functions reliably. Keep the existing
-- transactional implementation, but expose a uniquely named RPC endpoint.
CREATE OR REPLACE FUNCTION public.save_report_atomic_v2(
  p_organization_id uuid,
  p_report_id uuid,
  p_client_id uuid,
  p_shift_id uuid,
  p_segment_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_status text,
  p_values jsonb,
  p_session_id text DEFAULT NULL,
  p_actual_service_type_id uuid DEFAULT NULL,
  p_actual_staffs jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.save_report_atomic(
    p_organization_id,
    p_report_id,
    p_client_id,
    p_shift_id,
    p_segment_id,
    p_start_at,
    p_end_at,
    p_status,
    p_values,
    p_session_id,
    p_actual_service_type_id,
    p_actual_staffs
  );
$$;

REVOKE ALL ON FUNCTION public.save_report_atomic_v2(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_report_atomic_v2(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
