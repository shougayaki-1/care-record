-- Additive notification contract. Existing type/content/link_url remain intact.
ALTER TABLE public.notifications
  ADD COLUMN organization_id uuid,
  ADD COLUMN category text CHECK (category IN ('action_required', 'warning', 'info')),
  ADD COLUMN event_type text,
  ADD COLUMN priority text CHECK (priority IN ('normal', 'high', 'critical')),
  ADD COLUMN title text,
  ADD COLUMN resource_type text,
  ADD COLUMN resource_id uuid,
  ADD COLUMN actor_id uuid,
  ADD COLUMN read_at timestamptz,
  ADD COLUMN dedupe_key uuid;

-- Organization/actor IDs are historical references, deliberately independent
-- of membership lifetime. They do not grant access to the referenced resources.
-- Historical read times are unknown: this is the time the read state was observed.
UPDATE public.notifications SET read_at = statement_timestamp() WHERE is_read IS TRUE;

CREATE UNIQUE INDEX notifications_event_dedupe
  ON public.notifications (user_id, organization_id, event_type, dedupe_key)
  NULLS NOT DISTINCT WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_receiver_unread ON public.notifications (user_id, created_at DESC)
  WHERE is_read IS NOT TRUE;

CREATE FUNCTION private.sync_notification_read_at() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.is_read := coalesce(NEW.is_read, false);
  IF NEW.is_read THEN
    IF TG_OP = 'INSERT' THEN
      NEW.read_at := statement_timestamp();
    ELSIF OLD.is_read IS TRUE THEN
      NEW.read_at := OLD.read_at;
    ELSE
      NEW.read_at := statement_timestamp();
    END IF;
  ELSE
    NEW.read_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_notification_read_at() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER notifications_read_at BEFORE INSERT OR UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.sync_notification_read_at();
ALTER TABLE public.notifications ADD CONSTRAINT notifications_read_consistency
  CHECK ((is_read IS TRUE) = (read_at IS NOT NULL));

-- Keep recipient-only SELECT RLS, including after removal from an organization.
-- Clients may only change read state, never ownership, content or dedupe metadata.
REVOKE INSERT, UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;
CREATE POLICY "Active recipient notification updates" ON public.notifications
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_session_active()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.is_session_active()));

-- Internal building block for future authorized business RPCs. No browser grant.
-- Caller MUST derive receiver, actor and resource from an authorized mutation.
-- Templates are a frozen copy of src/lib/notifications/events.json; unit tests
-- compare the copies so that later edits require a new migration.
CREATE FUNCTION private.create_notification(
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
    "linkUrl": null
  },
  "deletion_request.approved": {
    "category": "info",
    "priority": "normal",
    "title": "削除申請が承認されました",
    "content": "申請の結果を確認してください。",
    "resourceType": "deletion_request",
    "linkUrl": null
  },
  "deletion_request.rejected": {
    "category": "info",
    "priority": "normal",
    "title": "削除申請が却下されました",
    "content": "申請の結果を確認してください。",
    "resourceType": "deletion_request",
    "linkUrl": null
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
  INSERT INTO public.notifications (user_id, organization_id, type, event_type, category, priority,
    title, content, resource_type, resource_id, actor_id, dedupe_key, link_url)
  VALUES (p_user_id, p_organization_id, p_event_type, p_event_type, template ->> 'category', template ->> 'priority',
    template ->> 'title', template ->> 'content',
    CASE WHEN p_resource_id IS NOT NULL THEN template ->> 'resourceType' END,
    p_resource_id, p_actor_id, p_dedupe_key, template ->> 'linkUrl')
  ON CONFLICT (user_id, organization_id, event_type, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO NOTHING RETURNING id INTO notification_id;
  RETURN notification_id;
END;
$$;
REVOKE ALL ON FUNCTION private.create_notification(uuid,uuid,text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.create_notification(uuid,uuid,text,uuid,uuid,uuid) TO service_role;

-- Only the already-approved backup infrastructure purpose may use this public
-- backend adapter. Normal business events stay inside authorized atomic RPCs.
CREATE FUNCTION public.create_notification(
  p_user_id uuid, p_event_type text, p_organization_id uuid DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL, p_dedupe_key uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_event_type <> 'backup.failed' OR p_event_type IS NULL THEN
    RAISE EXCEPTION 'notification_requires_business_rpc' USING ERRCODE = '42501';
  END IF;
  RETURN private.create_notification(p_user_id, p_organization_id, p_event_type, p_resource_id, p_actor_id, p_dedupe_key);
END;
$$;
REVOKE ALL ON FUNCTION public.create_notification(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid,text,uuid,uuid,uuid,uuid) TO service_role;
