-- Extend the existing fixed, non-sensitive notification templates.
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
  },
  "business.pending_reports": {
    "category": "action_required",
    "priority": "normal",
    "title": "未承認の記録があります",
    "content": "未承認の記録を確認してください。",
    "resourceType": null,
    "linkUrl": "/app/reports"
  },
  "business.unassigned_shifts": {
    "category": "action_required",
    "priority": "normal",
    "title": "未割当のシフトがあります",
    "content": "担当が未割当のシフトを確認してください。",
    "resourceType": null,
    "linkUrl": "/app/shifts/manage"
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
