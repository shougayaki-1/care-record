-- Follow the report mutation contract, isolated from report keys/operations.
-- No payload or staff names are retained in the key ledger or audit details.
CREATE TABLE public.internal_work_mutation_keys (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  record_id uuid NOT NULL REFERENCES public.internal_work_records(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_id, idempotency_key)
);
ALTER TABLE public.internal_work_mutation_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.internal_work_mutation_keys FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.internal_work_mutation_keys TO service_role;

CREATE FUNCTION public.save_internal_work_idempotent(
  p_organization_id uuid, p_staff_id uuid, p_idempotency_key uuid,
  p_title text, p_work_type text, p_start_at timestamptz, p_end_at timestamptz,
  p_work_hours numeric, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  scope text;
  title text := btrim(p_title);
  work_type text := COALESCE(NULLIF(btrim(p_work_type), ''), 'meeting');
  note text := NULLIF(btrim(p_note), '');
  payload_hash text;
  existing_key public.internal_work_mutation_keys%ROWTYPE;
  target uuid;
BEGIN
  IF actor IS NULL OR NOT private.is_session_active() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;
  IF p_organization_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'idempotency_key_required';
  END IF;

  -- Lock BEFORE checking the ledger. A waiting call observes the committed row
  -- after the first request, including when its response was lost.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'internal-work-save:' || p_organization_id::text || ':' || actor::text || ':' || p_idempotency_key::text, 0));
  IF NOT private.is_session_active() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required';
  END IF;

  -- Repeat the existing INSERT RLS contract even for a replay. SECURITY DEFINER
  -- permits create-only callers to receive their own result without view access.
  scope := private.get_member_internal_work_scope(p_organization_id, actor, 'create');
  IF scope = 'none' OR (scope = 'assigned' AND p_staff_id IS DISTINCT FROM private.get_actor_staff_id(p_organization_id, actor)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'permission_denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staffs s WHERE s.id = p_staff_id
    AND s.organization_id = p_organization_id AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'staff_not_found';
  END IF;
  IF title IS NULL OR length(title) NOT BETWEEN 1 AND 100
    OR p_start_at IS NULL OR p_end_at IS NULL
    OR NOT isfinite(p_start_at) OR NOT isfinite(p_end_at) OR p_end_at <= p_start_at
    OR p_work_hours IS NULL OR NOT (p_work_hours > 0 AND p_work_hours <= 24) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_internal_work_input';
  END IF;

  payload_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'staff_id', p_staff_id, 'title', title, 'work_type', work_type,
    'start_at', p_start_at AT TIME ZONE 'UTC', 'end_at', p_end_at AT TIME ZONE 'UTC',
    'work_hours', trim_scale(p_work_hours), 'note', note
  )::text, 'UTF8'), 'sha256'), 'hex');
  SELECT * INTO existing_key FROM public.internal_work_mutation_keys
    WHERE organization_id = p_organization_id AND actor_id = actor AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing_key.request_hash <> payload_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'CR409', MESSAGE = 'idempotency_key_reused';
    END IF;
    -- A replay must never recreate a record removed through the retention flow.
    IF NOT EXISTS (SELECT 1 FROM public.internal_work_records r
      WHERE r.id = existing_key.record_id AND r.organization_id = p_organization_id
        AND r.recorded_by = actor AND r.deleted_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'record_unavailable';
    END IF;
    RETURN jsonb_build_object('id', existing_key.record_id, 'replayed', true);
  END IF;

  INSERT INTO public.internal_work_records (
    organization_id, staff_id, recorded_by, title, work_type, start_at, end_at, work_hours, status, note
  ) VALUES (p_organization_id, p_staff_id, actor, title, work_type, p_start_at, p_end_at, p_work_hours, 'pending', note)
  RETURNING id INTO target;
  INSERT INTO public.internal_work_mutation_keys (organization_id, actor_id, idempotency_key, request_hash, record_id)
    VALUES (p_organization_id, actor, p_idempotency_key, payload_hash, target);
  -- As with existing atomic report RPCs, audit and persistence commit together.
  -- Replays do not emit an additional creation event.
  INSERT INTO public.audit_events (organization_id, actor_id, action_type, resource_type, resource_id, outcome, session_id, details)
    VALUES (p_organization_id, actor, 'internal_work.create', 'internal_work_record', target, 'success', auth.jwt()->>'session_id', '{}'::jsonb);
  RETURN jsonb_build_object('id', target, 'replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.save_internal_work_idempotent(uuid, uuid, uuid, text, text, timestamptz, timestamptz, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_internal_work_idempotent(uuid, uuid, uuid, text, text, timestamptz, timestamptz, numeric, text) TO authenticated;
