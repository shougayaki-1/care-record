-- Issue #63: account mutations and required notifications commit together.
CREATE OR REPLACE FUNCTION private.create_notification(
  p_user_id uuid, p_organization_id uuid, p_event_type text,
  p_resource_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL, p_dedupe_key uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  templates constant jsonb := $notification_templates${
  "report.submitted": {
    "category": "action_required",
    "priority": "high",
    "title": "記録の承認待ち",
    "content": "提出された記録を確認してください。",
    "resourceType": "report",
    "linkUrl": "/app/reports"
  },
  "report.approved": {
    "category": "info",
    "priority": "normal",
    "title": "記録が承認されました",
    "content": "提出した記録が承認されました。",
    "resourceType": "report",
    "linkUrl": "/app/reports"
  },
  "report.remanded": {
    "category": "action_required",
    "priority": "high",
    "title": "記録が差し戻されました",
    "content": "内容を確認して修正してください。",
    "resourceType": "report",
    "linkUrl": "/app/reports"
  },
  "deletion_request.created": {
    "category": "action_required",
    "priority": "high",
    "title": "削除申請の確認待ち",
    "content": "削除申請を確認してください。",
    "resourceType": "deletion_request",
    "linkUrl": "/app/reports/deletion-requests"
  },
  "deletion_request.approved": {
    "category": "info",
    "priority": "normal",
    "title": "削除申請が承認されました",
    "content": "申請の結果を確認してください。",
    "resourceType": "deletion_request",
    "linkUrl": "/app/reports/deletion-requests"
  },
  "deletion_request.rejected": {
    "category": "action_required",
    "priority": "high",
    "title": "削除申請が却下されました",
    "content": "申請の結果を確認してください。",
    "resourceType": "deletion_request",
    "linkUrl": "/app/reports/deletion-requests"
  },
  "shift.assigned": {
    "category": "info",
    "priority": "normal",
    "title": "シフトが割り当てられました",
    "content": "担当シフトを確認してください。",
    "resourceType": "shift",
    "linkUrl": "/app/shifts/my"
  },
  "shift.unassigned": {
    "category": "action_required",
    "priority": "normal",
    "title": "シフトの担当が解除されました",
    "content": "担当シフトの変更を確認してください。",
    "resourceType": "shift",
    "linkUrl": "/app/shifts/my"
  },
  "shift.time_changed": {
    "category": "action_required",
    "priority": "high",
    "title": "シフトの時間が変更されました",
    "content": "変更後のシフトを確認してください。",
    "resourceType": "shift",
    "linkUrl": "/app/shifts/my"
  },
  "shift.cancelled": {
    "category": "action_required",
    "priority": "high",
    "title": "シフトが中止されました",
    "content": "担当シフトの変更を確認してください。",
    "resourceType": "shift",
    "linkUrl": "/app/shifts/my"
  },
  "shift.reopened": {
    "category": "action_required",
    "priority": "high",
    "title": "シフトが再開されました",
    "content": "担当シフトの変更を確認してください。",
    "resourceType": "shift",
    "linkUrl": "/app/shifts/my"
  },
  "google_calendar.sync_failed": {
    "category": "warning",
    "priority": "high",
    "title": "Googleカレンダーの同期に失敗しました",
    "content": "未同期のシフトを確認してください。",
    "resourceType": null,
    "linkUrl": "/app/shifts/manage"
  },
  "backup.failed": {
    "category": "warning",
    "priority": "critical",
    "title": "バックアップに失敗しました",
    "content": "バックアップの状態を確認してください。",
    "resourceType": null,
    "linkUrl": "/app/backup"
  },
  "account.permissions_changed": {
    "category": "action_required",
    "priority": "normal",
    "title": "権限が変更されました",
    "content": "事業所で利用できる機能が変更されました。",
    "resourceType": "account",
    "linkUrl": null
  },
  "account.removed_from_organization": {
    "category": "action_required",
    "priority": "high",
    "title": "事業所の所属が解除されました",
    "content": "この事業所へのアクセス権がなくなりました。",
    "resourceType": "account",
    "linkUrl": null
  }
}$notification_templates$::jsonb;
  template jsonb;
  notification_id uuid;
  destination text;
  client_id uuid;
BEGIN
  template := templates -> p_event_type;
  IF template IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_notification_event' USING ERRCODE = '22023';
  END IF;
  IF p_organization_id IS NULL THEN
    IF p_event_type <> 'backup.failed' OR p_actor_id IS NOT NULL OR p_resource_id IS NOT NULL THEN
      RAISE EXCEPTION 'notification_organization_required' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
      RAISE EXCEPTION 'notification_organization_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_event_type <> 'account.removed_from_organization' AND NOT EXISTS (
      SELECT 1 FROM public.organization_members WHERE organization_id = p_organization_id AND user_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'notification_receiver_not_member' USING ERRCODE = '42501';
    END IF;
    IF p_actor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.organization_members WHERE organization_id = p_organization_id AND user_id = p_actor_id
    ) THEN
      RAISE EXCEPTION 'notification_actor_not_member' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_resource_id IS NOT NULL THEN
    CASE template ->> 'resourceType'
      WHEN 'report' THEN
        IF NOT EXISTS (SELECT 1 FROM public.reports r JOIN public.clients c ON c.id = r.client_id
          WHERE r.id = p_resource_id AND c.organization_id = p_organization_id) THEN
          RAISE EXCEPTION 'notification_resource_invalid' USING ERRCODE = '42501';
        END IF;
      WHEN 'shift' THEN
        IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = p_resource_id AND organization_id = p_organization_id) THEN
          RAISE EXCEPTION 'notification_resource_invalid' USING ERRCODE = '42501';
        END IF;
      WHEN 'deletion_request' THEN
        IF NOT EXISTS (SELECT 1 FROM public.deletion_requests WHERE id = p_resource_id AND organization_id = p_organization_id) THEN
          RAISE EXCEPTION 'notification_resource_invalid' USING ERRCODE = '42501';
        END IF;
      WHEN 'account' THEN
        IF p_resource_id <> p_user_id THEN
          RAISE EXCEPTION 'notification_resource_invalid' USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'notification_resource_invalid' USING ERRCODE = '22023';
    END CASE;
  END IF;
  destination := template ->> 'linkUrl';
  IF p_resource_id IS NOT NULL AND template ->> 'resourceType' = 'report' THEN
    SELECT r.client_id INTO client_id FROM public.reports r WHERE r.id = p_resource_id;
    destination := '/app/record/' || client_id::text || '?reportId=' || p_resource_id::text;
    IF p_dedupe_key IS NOT NULL THEN destination := destination || '&draftKey=' || p_dedupe_key::text; END IF;
  ELSIF p_resource_id IS NOT NULL AND template ->> 'resourceType' = 'deletion_request' THEN
    destination := destination || '?requestId=' || p_resource_id::text;
  END IF;
  INSERT INTO public.notifications (user_id, organization_id, type, event_type, category, priority,
    title, content, resource_type, resource_id, actor_id, dedupe_key, link_url)
  VALUES (p_user_id, p_organization_id, p_event_type, p_event_type, template ->> 'category', template ->> 'priority',
    template ->> 'title', template ->> 'content',
    CASE WHEN p_resource_id IS NOT NULL THEN template ->> 'resourceType' END,
    p_resource_id, p_actor_id, p_dedupe_key, destination)
  ON CONFLICT (user_id, organization_id, event_type, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO NOTHING RETURNING id INTO notification_id;
  RETURN notification_id;
END;
$$;

-- Compare the existing DB permission helpers, including owner implicit rights.
-- Permission JSON and role identifiers never leave this private comparison state.
CREATE FUNCTION private.account_notification_snapshot(p_org_id uuid,p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE membership_role text; result jsonb; action text;
BEGIN
  SELECT role INTO membership_role FROM public.organization_members
    WHERE organization_id=p_org_id AND user_id=p_user_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  result:=jsonb_build_object('role',membership_role);
  FOREACH action IN ARRAY ARRAY['view','create','edit','delete','approve'] LOOP
    result:=result || jsonb_build_object('records.'||action,private.get_member_record_action_scope(p_org_id,p_user_id,action));
  END LOOP;
  FOREACH action IN ARRAY ARRAY['view','create','edit','delete'] LOOP
    result:=result || jsonb_build_object('shifts.'||action,private.get_member_shift_action_scope(p_org_id,p_user_id,action));
  END LOOP;
  FOREACH action IN ARRAY ARRAY['view','create'] LOOP
    result:=result || jsonb_build_object('internalWork.'||action,private.get_member_internal_work_scope(p_org_id,p_user_id,action));
  END LOOP;
  FOREACH action IN ARRAY ARRAY['staffs','clients','accounts','organization','integrations','auditLogs',
    'backupStatus','reports','roles','organizationDelete','ownerTransfer'] LOOP
    result:=result || jsonb_build_object('management.'||action,private.has_management_permission(p_org_id,p_user_id,action));
  END LOOP;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION private.account_notification_snapshot(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.account_notification_state (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL,
  snapshot jsonb,
  actor_id uuid,
  occurrence uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY(organization_id,user_id)
);
ALTER TABLE private.account_notification_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.account_notification_state FROM PUBLIC, anon, authenticated, service_role;
-- Seed without sending historical notifications on upgrade.
INSERT INTO private.account_notification_state(organization_id,user_id,snapshot)
SELECT organization_id,user_id,private.account_notification_snapshot(organization_id,user_id)
FROM public.organization_members;

CREATE FUNCTION private.queue_account_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org_id uuid; target_id uuid; recipient record;
BEGIN
  IF TG_TABLE_NAME='organization_roles' THEN
    IF TG_OP='UPDATE' AND OLD.permissions IS NOT DISTINCT FROM NEW.permissions THEN RETURN NEW; END IF;
    -- Lock recipient state in a stable order for shared-role changes.
    FOR recipient IN SELECT organization_id,user_id FROM public.organization_member_roles
      WHERE role_id=OLD.id ORDER BY organization_id,user_id LOOP
      INSERT INTO private.account_notification_state(organization_id,user_id,snapshot,actor_id)
      VALUES(recipient.organization_id,recipient.user_id,
        private.account_notification_snapshot(recipient.organization_id,recipient.user_id),auth.uid())
      ON CONFLICT(organization_id,user_id) DO UPDATE SET actor_id=auth.uid(),occurrence=gen_random_uuid();
    END LOOP;
  ELSE
    org_id:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
    target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
    IF TG_TABLE_NAME='organization_members' AND TG_OP='UPDATE' THEN
      IF OLD.role IS NOT DISTINCT FROM NEW.role THEN RETURN NEW; END IF;
    END IF;
    INSERT INTO private.account_notification_state(organization_id,user_id,snapshot,actor_id)
    VALUES(org_id,target_id,private.account_notification_snapshot(org_id,target_id),auth.uid())
    ON CONFLICT(organization_id,user_id) DO UPDATE SET actor_id=auth.uid(),occurrence=gen_random_uuid();
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.queue_account_notification() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER members_queue_account_notification BEFORE INSERT OR UPDATE OR DELETE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION private.queue_account_notification();
CREATE TRIGGER member_roles_queue_account_notification BEFORE INSERT OR DELETE ON public.organization_member_roles
FOR EACH ROW EXECUTE FUNCTION private.queue_account_notification();
CREATE TRIGGER roles_queue_account_notification BEFORE UPDATE OR DELETE ON public.organization_roles
FOR EACH ROW EXECUTE FUNCTION private.queue_account_notification();

CREATE FUNCTION private.flush_account_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state private.account_notification_state%ROWTYPE; current_snapshot jsonb; event text;
BEGIN
  SELECT * INTO state FROM private.account_notification_state
    WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id FOR UPDATE;
  current_snapshot:=private.account_notification_snapshot(state.organization_id,state.user_id);
  IF current_snapshot IS NOT DISTINCT FROM state.snapshot THEN RETURN NEW; END IF;
  -- Initial membership/invitation acceptance, explicit self changes/withdrawal,
  -- org deletion and disabled accounts are outside this notification scope.
  IF state.snapshot IS NOT NULL AND state.actor_id IS NOT NULL AND state.actor_id<>state.user_id
    AND EXISTS(SELECT 1 FROM public.organizations WHERE id=state.organization_id AND deleted_at IS NULL)
    AND EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=state.organization_id AND user_id=state.actor_id)
    AND EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
      WHERE p.id=state.user_id AND p.deleted_at IS NULL AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
        AND COALESCE(to_jsonb(p)->>'role','')<>'super_admin') THEN
    event:=CASE WHEN current_snapshot IS NULL THEN 'account.removed_from_organization' ELSE 'account.permissions_changed' END;
    PERFORM private.create_notification(state.user_id,state.organization_id,event,state.user_id,state.actor_id,state.occurrence);
  END IF;
  UPDATE private.account_notification_state SET snapshot=current_snapshot
    WHERE organization_id=state.organization_id AND user_id=state.user_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notification_creation_failed: account (required)';
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION private.flush_account_notifications() FROM PUBLIC, anon, authenticated, service_role;
CREATE CONSTRAINT TRIGGER account_notifications_after_insert AFTER INSERT ON private.account_notification_state
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.flush_account_notifications();
CREATE CONSTRAINT TRIGGER account_notifications_after_update AFTER UPDATE ON private.account_notification_state
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.occurrence IS DISTINCT FROM NEW.occurrence)
EXECUTE FUNCTION private.flush_account_notifications();

CREATE OR REPLACE FUNCTION public.account_replace_member_roles(
  p_organization_id uuid, p_target_user_id uuid, p_role_ids uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_actor_owner boolean;
BEGIN
  -- Serialize with owner changes/removal and shared-role edits before comparing permissions.
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.has_management_permission(p_organization_id, v_actor, 'accounts') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = p_organization_id AND user_id = p_target_user_id)
  THEN RAISE EXCEPTION 'member_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_role_ids, ARRAY[]::uuid[])) rid
             LEFT JOIN public.organization_roles r ON r.id = rid AND r.organization_id = p_organization_id WHERE r.id IS NULL)
  THEN RAISE EXCEPTION 'invalid_role'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id=p_organization_id AND user_id=v_actor AND role='owner') INTO v_actor_owner;
  IF NOT v_actor_owner AND EXISTS (
    SELECT 1 FROM public.organization_roles r
    WHERE r.id = ANY(COALESCE(p_role_ids, ARRAY[]::uuid[]))
      AND private.role_permissions_dangerous(r.permissions)
  ) THEN RAISE EXCEPTION 'owner_required'; END IF;
  DELETE FROM public.organization_member_roles WHERE organization_id=p_organization_id AND user_id=p_target_user_id;
  INSERT INTO public.organization_member_roles(organization_id,user_id,role_id)
    SELECT p_organization_id,p_target_user_id,rid FROM unnest(COALESCE(p_role_ids, ARRAY[]::uuid[])) rid;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om WHERE om.organization_id=p_organization_id
      AND private.has_management_permission(p_organization_id, om.user_id, 'roles')
  ) THEN RAISE EXCEPTION 'last_role_manager'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mutate_organization_role_authorized(
 p_organization_id uuid,p_role_id uuid,p_action text,p_name text,p_color text,p_permissions jsonb,p_require_preset boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_is_owner boolean; v_target public.organization_roles%ROWTYPE;
BEGIN
  -- Serialize with owner changes/removal and shared-role edits before comparing permissions.
  PERFORM 1 FROM public.organizations WHERE id=p_organization_id FOR UPDATE;
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
    SELECT * INTO v_target FROM public.organization_roles
      WHERE id=p_role_id AND organization_id=p_organization_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'role_not_found' USING ERRCODE='P0002'; END IF;
    IF v_target.is_preset THEN RAISE EXCEPTION 'preset_role_delete_forbidden' USING ERRCODE='42501'; END IF;
    IF private.role_permissions_dangerous(v_target.permissions) AND NOT v_is_owner THEN
      RAISE EXCEPTION 'owner_required' USING ERRCODE='42501'; END IF;
    DELETE FROM public.organization_roles WHERE id=p_role_id AND organization_id=p_organization_id RETURNING id INTO v_id;
  ELSE RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'role_not_found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_members om
    WHERE om.organization_id=p_organization_id AND private.has_management_permission(p_organization_id, om.user_id, 'roles')) THEN
    RAISE EXCEPTION 'last_role_manager' USING ERRCODE='22023'; END IF;
  RETURN v_id;
END; $$;

-- Existing RPC signatures and grants are preserved; no new mutation entry point.
REVOKE ALL ON FUNCTION public.account_replace_member_roles(uuid,uuid,uuid[]),
  public.mutate_organization_role_authorized(uuid,uuid,text,text,text,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_replace_member_roles(uuid,uuid,uuid[]),
  public.mutate_organization_role_authorized(uuid,uuid,text,text,text,jsonb,boolean) TO authenticated;
