-- Issue #60: authorized status mutations and notifications commit together.
-- No backfill: historical transitions must not notify current recipients.
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
    "category": "info",
    "priority": "normal",
    "title": "シフトの担当が解除されました",
    "content": "担当シフトの変更を確認してください。",
    "resourceType": "shift",
    "linkUrl": "/app/shifts/my"
  },
  "shift.time_changed": {
    "category": "info",
    "priority": "high",
    "title": "シフトの時間が変更されました",
    "content": "変更後のシフトを確認してください。",
    "resourceType": "shift",
    "linkUrl": "/app/shifts/my"
  },
  "shift.cancelled": {
    "category": "info",
    "priority": "high",
    "title": "シフトが中止されました",
    "content": "担当シフトの変更を確認してください。",
    "resourceType": "shift",
    "linkUrl": "/app/shifts/my"
  },
  "shift.reopened": {
    "category": "info",
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
    "category": "info",
    "priority": "normal",
    "title": "権限が変更されました",
    "content": "事業所で利用できる機能が変更されました。",
    "resourceType": "account",
    "linkUrl": null
  },
  "account.removed_from_organization": {
    "category": "info",
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

-- Creator owns only their request; report management visibility is unchanged.
CREATE POLICY "Applicants read own deletion requests" ON public.deletion_requests
  FOR SELECT TO authenticated USING (
    resource_type = 'report' AND requested_by = (SELECT auth.uid()) AND private.is_session_active()
    AND private.is_org_member(organization_id)
  );

CREATE OR REPLACE FUNCTION public.request_report_deletion(p_org_id uuid, p_report_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF length(trim(p_reason)) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION 'invalid_reason'; END IF;
  IF NOT public.is_org_member(p_org_id) THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reports r JOIN public.clients c ON c.id=r.client_id
    WHERE r.id=p_report_id AND c.organization_id=p_org_id AND r.deleted_at IS NULL) THEN RAISE EXCEPTION 'report_not_found'; END IF;
  -- Serialize retries for the same applicant/report. An open request is one
  -- occurrence even when two clients submit it concurrently with different reasons.
  PERFORM pg_advisory_xact_lock(hashtextextended('report-deletion:' || p_org_id::text || ':' || p_report_id::text || ':' || v_actor::text, 0));
  SELECT id INTO v_id FROM public.deletion_requests
    WHERE organization_id=p_org_id AND resource_type='report' AND resource_id=p_report_id
      AND requested_by=v_actor AND status='requested' ORDER BY requested_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;
  INSERT INTO public.deletion_requests(organization_id,resource_type,resource_id,requested_by,reason,status)
  VALUES(p_org_id,'report',p_report_id,v_actor,trim(p_reason),'requested') RETURNING id INTO v_id;
  RETURN v_id;
END $$;


-- Business recipients must still be able to use an active organization/account.
-- The optional legacy profiles.role marker is absent on hosted Production.
CREATE FUNCTION private.report_workflow_recipients(p_org_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.user_id FROM public.organization_members m
  JOIN public.organizations o ON o.id=m.organization_id AND o.deleted_at IS NULL
  JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL
    AND (to_jsonb(p)->>'role') IS DISTINCT FROM 'super_admin'
  JOIN auth.users u ON u.id=m.user_id AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
  WHERE m.organization_id=p_org_id;
$$;
REVOKE ALL ON FUNCTION private.report_workflow_recipients(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- AFTER triggers execute inside the existing versioned/authorized RPC transaction.
-- They do not change report history, audit events, or business authorization.
CREATE FUNCTION private.notify_report_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org_id uuid;
  occurrence uuid := gen_random_uuid();
  receiver uuid;
  event_name text;
  scope text;
BEGIN
  IF auth.uid() IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  END IF;
  event_name := CASE NEW.status WHEN 'pending' THEN 'report.submitted'
    WHEN 'approved' THEN 'report.approved' WHEN 'remanded' THEN 'report.remanded' END;
  IF event_name IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id INTO org_id FROM public.clients WHERE id = NEW.client_id;
  IF event_name = 'report.submitted' THEN
    FOR receiver IN SELECT * FROM private.report_workflow_recipients(org_id) LOOP
      scope := private.get_member_record_action_scope(org_id, receiver, 'approve');
      IF private.has_management_permission(org_id, receiver, 'reports') AND
        (scope = 'all' OR (scope = 'assigned' AND private.is_assigned_client_for_user(NEW.client_id, org_id, receiver))) THEN
        PERFORM private.create_notification(receiver, org_id, event_name, NEW.id, auth.uid(), occurrence);
      END IF;
    END LOOP;
  ELSIF EXISTS (SELECT 1 FROM private.report_workflow_recipients(org_id) recipient WHERE recipient = NEW.helper_id) THEN
    PERFORM private.create_notification(NEW.helper_id, org_id, event_name, NEW.id, auth.uid(), occurrence);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never log inputs, record text, reasons or the raw DB error.
  RAISE LOG 'notification_creation_failed: report_status (required)';
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_report_status() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER reports_business_notifications AFTER INSERT OR UPDATE OF status ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.notify_report_status();

CREATE FUNCTION private.notify_report_deletion_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  receiver uuid;
  event_name text;
BEGIN
  IF auth.uid() IS NULL OR NEW.resource_type <> 'report' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'requested' OR NEW.status NOT IN ('approved', 'completed', 'rejected') THEN RETURN NEW; END IF;
    event_name := CASE WHEN NEW.status = 'rejected' THEN 'deletion_request.rejected' ELSE 'deletion_request.approved' END;
    IF EXISTS (SELECT 1 FROM private.report_workflow_recipients(NEW.organization_id) recipient WHERE recipient = NEW.requested_by) THEN
      PERFORM private.create_notification(NEW.requested_by, NEW.organization_id, event_name, NEW.id, auth.uid(), NEW.id);
    END IF;
  ELSIF NEW.status = 'requested' THEN
    -- Rejection requires reports management only, so these recipients can take
    -- a real decision even if they cannot approve. Approval retains the existing
    -- delete checks (assignment in the Action, authorship in the DB RPC).
    FOR receiver IN SELECT * FROM private.report_workflow_recipients(NEW.organization_id) LOOP
      IF private.has_management_permission(NEW.organization_id, receiver, 'reports') THEN
        PERFORM private.create_notification(receiver, NEW.organization_id, 'deletion_request.created', NEW.id, auth.uid(), NEW.id);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notification_creation_failed: deletion_request (required)';
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_report_deletion_request() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER deletion_requests_business_notifications AFTER INSERT OR UPDATE OF status ON public.deletion_requests
  FOR EACH ROW EXECUTE FUNCTION private.notify_report_deletion_request();
