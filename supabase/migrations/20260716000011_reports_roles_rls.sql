-- Authenticated report/role operations. SECURITY DEFINER RPCs are intentionally
-- narrow and re-check the JWT actor, tenant, permission scope, and target rows.

GRANT INSERT ON TABLE public.report_images TO authenticated;

CREATE OR REPLACE FUNCTION private.can_record_action_for_client(
  p_organization_id uuid, p_client_id uuid, p_action text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id=p_client_id AND c.organization_id=p_organization_id)
    AND (
      private.get_member_record_action_scope(p_organization_id, auth.uid(), p_action) = 'all'
      OR (private.get_member_record_action_scope(p_organization_id, auth.uid(), p_action) = 'assigned'
          AND private.is_assigned_client_for_user(p_client_id, p_organization_id, auth.uid()))
    );
$$;

-- Private report images are stored only at
-- {organization UUID}/{report UUID}/{object UUID}.webp. Storage requests use the
-- caller JWT; these policies bind every object path back to an authorized report.
DROP POLICY IF EXISTS "Authorized report image upload" ON storage.objects;
CREATE POLICY "Authorized report image upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'report-images'
    AND (SELECT private.is_session_active())
    AND array_length(storage.foldername(name), 1) = 2
    AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    AND COALESCE(metadata ->> 'mimetype', '') = 'image/webp'
    AND COALESCE((metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 10485760
    AND EXISTS (
      SELECT 1 FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE c.organization_id::text = (storage.foldername(name))[1]
        AND r.id::text = (storage.foldername(name))[2]
        AND r.deleted_at IS NULL AND r.status <> 'approved'
        AND private.can_record_action_for_client(c.organization_id, c.id, 'edit')
    )
  );

DROP POLICY IF EXISTS "Authorized report image cleanup" ON storage.objects;
CREATE POLICY "Authorized report image cleanup" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'report-images'
    AND (SELECT private.is_session_active())
    AND array_length(storage.foldername(name), 1) = 2
    AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    AND EXISTS (
      SELECT 1 FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE c.organization_id::text = (storage.foldername(name))[1]
        AND r.id::text = (storage.foldername(name))[2]
        AND r.deleted_at IS NULL AND r.status <> 'approved'
        AND private.can_record_action_for_client(c.organization_id, c.id, 'edit')
    )
  );

DROP POLICY IF EXISTS "Authorized report image signed read" ON storage.objects;
CREATE POLICY "Authorized report image signed read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'report-images'
    AND (SELECT private.is_session_active())
    AND array_length(storage.foldername(name), 1) = 2
    AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    AND EXISTS (
      SELECT 1 FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE c.organization_id::text = (storage.foldername(name))[1]
        AND r.id::text = (storage.foldername(name))[2]
        AND r.deleted_at IS NULL
        AND private.can_record_action_for_client(c.organization_id, c.id, 'view')
    )
  );

CREATE OR REPLACE FUNCTION public.save_report_autosave_authorized(
  p_organization_id uuid, p_client_id uuid, p_report_id uuid, p_draft_key uuid,
  p_base_content_revision bigint, p_autosave_revision bigint, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_updated timestamptz;
BEGIN
  IF NOT private.can_record_action_for_client(p_organization_id,p_client_id,'edit')
     OR (p_report_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.reports r WHERE r.id=p_report_id AND r.client_id=p_client_id AND r.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  IF p_autosave_revision < 0 OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text)>1000000 THEN
    RAISE EXCEPTION 'invalid_autosave' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.report_autosaves(draft_key,organization_id,client_id,report_id,editor_user_id,
    base_content_revision,autosave_revision,payload,expires_at,updated_at)
  VALUES(p_draft_key,p_organization_id,p_client_id,p_report_id,auth.uid(),p_base_content_revision,
    p_autosave_revision,p_payload,now()+interval '30 days',now())
  ON CONFLICT(draft_key) DO UPDATE SET
    organization_id=EXCLUDED.organization_id,client_id=EXCLUDED.client_id,report_id=EXCLUDED.report_id,
    base_content_revision=EXCLUDED.base_content_revision,autosave_revision=EXCLUDED.autosave_revision,
    payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at
  WHERE report_autosaves.editor_user_id=auth.uid()
    AND report_autosaves.autosave_revision < EXCLUDED.autosave_revision
  RETURNING updated_at INTO v_updated;
  IF v_updated IS NULL THEN RETURN jsonb_build_object('saved',false,'stale',true,'savedAt',NULL); END IF;
  RETURN jsonb_build_object('saved',true,'stale',false,'savedAt',v_updated);
END; $$;

CREATE OR REPLACE FUNCTION public.load_report_autosave_authorized(p_organization_id uuid,p_draft_key uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.report_autosaves%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.report_autosaves a WHERE a.draft_key=p_draft_key
    AND a.organization_id=p_organization_id AND a.editor_user_id=auth.uid() AND a.expires_at>now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT private.can_record_action_for_client(p_organization_id,v_row.client_id,'edit') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('payload',v_row.payload,'autosave_revision',v_row.autosave_revision,
    'report_id',v_row.report_id,'client_id',v_row.client_id,'base_content_revision',v_row.base_content_revision,
    'updated_at',v_row.updated_at);
END; $$;

CREATE OR REPLACE FUNCTION public.discard_report_autosave_authorized(p_organization_id uuid,p_draft_key uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_org_member(p_organization_id) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  DELETE FROM public.report_autosaves WHERE draft_key=p_draft_key AND organization_id=p_organization_id AND editor_user_id=auth.uid();
END; $$;

CREATE OR REPLACE FUNCTION public.transition_reports_authorized(p_organization_id uuid,p_report_ids uuid[],p_transition text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer; v_now timestamptz:=now();
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_management_permission(p_organization_id,auth.uid(),'reports')
     OR p_transition NOT IN ('approve','remand') OR COALESCE(cardinality(p_report_ids),0) NOT BETWEEN 1 AND 100
     OR cardinality(p_report_ids)<>(SELECT count(DISTINCT x)::integer FROM unnest(p_report_ids) x) THEN
    RAISE EXCEPTION 'permission_denied_or_invalid' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_count FROM public.reports r JOIN public.clients c ON c.id=r.client_id
   WHERE r.id=ANY(p_report_ids) AND c.organization_id=p_organization_id AND r.deleted_at IS NULL
     AND private.can_record_action_for_client(p_organization_id,c.id,'approve')
     AND ((p_transition='approve' AND r.status<>'draft') OR (p_transition='remand' AND r.status='approved'));
  IF v_count<>cardinality(p_report_ids) THEN RAISE EXCEPTION 'invalid_or_inaccessible_reports' USING ERRCODE='22023'; END IF;
  UPDATE public.reports SET status=CASE WHEN p_transition='approve' THEN 'approved' ELSE 'remanded' END,
    approved_by=CASE WHEN p_transition='approve' THEN auth.uid() ELSE NULL END,
    approved_at=CASE WHEN p_transition='approve' THEN v_now ELSE NULL END,updated_at=v_now
  WHERE id=ANY(p_report_ids);
END; $$;

CREATE OR REPLACE FUNCTION public.soft_delete_reports_authorized(
 p_organization_id uuid,p_report_ids uuid[],p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_count integer;
  v_years integer;
  v_legal_basis text;
  v_now timestamptz:=now();
  v_retention_until timestamptz;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(cardinality(p_report_ids),0) NOT BETWEEN 1 AND 100
     OR cardinality(p_report_ids)<>(SELECT count(DISTINCT x)::integer FROM unnest(p_report_ids) x)
     OR length(trim(p_reason)) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  SELECT retention_years, legal_basis INTO v_years, v_legal_basis FROM public.retention_policies
    WHERE organization_id=p_organization_id AND resource_type='report';
  IF v_years IS NULL THEN RAISE EXCEPTION 'retention_policy_missing' USING ERRCODE='22023'; END IF;
  v_retention_until := v_now+make_interval(years=>v_years);
  SELECT count(*) INTO v_count FROM public.reports r JOIN public.clients c ON c.id=r.client_id
   WHERE r.id=ANY(p_report_ids) AND c.organization_id=p_organization_id AND r.deleted_at IS NULL AND r.status<>'approved'
     AND private.can_record_action_for_client(p_organization_id,c.id,'delete');
  IF v_count<>cardinality(p_report_ids) THEN RAISE EXCEPTION 'invalid_or_inaccessible_reports' USING ERRCODE='22023'; END IF;
  UPDATE public.reports SET deleted_at=v_now,deleted_by=auth.uid(),deletion_reason=trim(p_reason),
    retention_until=v_retention_until,updated_at=v_now WHERE id=ANY(p_report_ids);
  RETURN jsonb_build_object('retentionUntil',v_retention_until,'legalBasis',v_legal_basis);
END; $$;

CREATE OR REPLACE FUNCTION public.restore_reports_authorized(p_organization_id uuid,p_report_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(cardinality(p_report_ids),0) NOT BETWEEN 1 AND 100
     OR cardinality(p_report_ids)<>(SELECT count(DISTINCT x)::integer FROM unnest(p_report_ids) x)
    THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_count FROM public.reports r JOIN public.clients c ON c.id=r.client_id
   WHERE r.id=ANY(p_report_ids) AND c.organization_id=p_organization_id AND r.deleted_at IS NOT NULL
     AND private.can_record_action_for_client(p_organization_id,c.id,'delete');
  IF v_count<>cardinality(p_report_ids) THEN RAISE EXCEPTION 'invalid_or_inaccessible_reports' USING ERRCODE='22023'; END IF;
  UPDATE public.reports SET deleted_at=NULL,deleted_by=NULL,deletion_reason=NULL,retention_until=NULL,updated_at=now()
    WHERE id=ANY(p_report_ids);
END; $$;

CREATE OR REPLACE FUNCTION private.role_permissions_dangerous(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT COALESCE((p->'management'->>'accounts')::boolean,false)
 OR COALESCE((p->'management'->>'roles')::boolean,false) OR COALESCE((p->'management'->>'organizationDelete')::boolean,false)
 OR COALESCE((p->'management'->>'ownerTransfer')::boolean,false); $$;

CREATE OR REPLACE FUNCTION public.mutate_organization_role_authorized(
 p_organization_id uuid,p_role_id uuid,p_action text,p_name text,p_color text,p_permissions jsonb,p_require_preset boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_is_owner boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_org_member(p_organization_id)
    OR NOT private.has_management_permission(p_organization_id,auth.uid(),'roles') THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF p_action IN ('create','update') AND (p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'invalid_role_name' USING ERRCODE='22023'; END IF;
  IF p_action IN ('create','update','reset') AND jsonb_typeof(p_permissions)<>'object' THEN
    RAISE EXCEPTION 'invalid_permissions' USING ERRCODE='22023'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_organization_id AND user_id=auth.uid() AND role='owner') INTO v_is_owner;
  IF p_permissions IS NOT NULL AND private.role_permissions_dangerous(p_permissions) AND NOT v_is_owner THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='42501'; END IF;
  IF p_action='create' THEN
    INSERT INTO public.organization_roles(organization_id,name,color,is_preset,permissions) VALUES(p_organization_id,p_name,p_color,false,p_permissions) RETURNING id INTO v_id;
  ELSIF p_action='update' THEN
    UPDATE public.organization_roles SET name=COALESCE(p_name,name),color=p_color,permissions=p_permissions
      WHERE id=p_role_id AND organization_id=p_organization_id AND (NOT p_require_preset OR is_preset) RETURNING id INTO v_id;
  ELSIF p_action='reset' THEN
    UPDATE public.organization_roles SET permissions=p_permissions
      WHERE id=p_role_id AND organization_id=p_organization_id AND is_preset RETURNING id INTO v_id;
  ELSIF p_action='delete' THEN
    DELETE FROM public.organization_roles WHERE id=p_role_id AND organization_id=p_organization_id RETURNING id INTO v_id;
  ELSE RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'role_not_found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.role_id
    WHERE mr.organization_id=p_organization_id AND COALESCE((r.permissions->'management'->>'roles')::boolean,false)) THEN
    RAISE EXCEPTION 'last_role_manager' USING ERRCODE='22023'; END IF;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION private.can_record_action_for_client(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.role_permissions_dangerous(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_record_action_for_client(uuid,uuid,text) TO authenticated;
DO $$ DECLARE f record; BEGIN FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('save_report_autosave_authorized','load_report_autosave_authorized','discard_report_autosave_authorized','transition_reports_authorized','soft_delete_reports_authorized','restore_reports_authorized','mutate_organization_role_authorized') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.sig); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig); END LOOP; END $$;
