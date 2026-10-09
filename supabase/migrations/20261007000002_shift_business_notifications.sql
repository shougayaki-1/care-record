-- Issue #61: final shift state and notifications commit atomically.
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

-- One identifier/schedule comparison state per shift, scoped by organization. This is
-- implementation state, not a business history or an audit replacement.
CREATE TABLE private.shift_notification_state (
  shift_id uuid PRIMARY KEY REFERENCES public.shifts(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  occurrence uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE private.shift_notification_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.shift_notification_state FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.shift_notification_snapshot(p_shift_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('start_at',extract(epoch FROM s.start_at),'end_at',extract(epoch FROM s.end_at),
    'status',s.status,'deleted',s.deleted_at IS NOT NULL,'staffs',COALESCE((
      SELECT jsonb_object_agg(ss.staff_id::text, COALESCE((
        SELECT jsonb_agg(times ORDER BY times::text) FROM (
          SELECT DISTINCT jsonb_build_array(extract(epoch FROM seg.start_at),extract(epoch FROM seg.end_at)) AS times
          FROM public.shift_segments seg JOIN public.shift_segment_staffs st ON st.segment_id=seg.id
          WHERE seg.shift_id=s.id AND st.staff_id=ss.staff_id
        ) schedules
      ),'[]'::jsonb)) FROM public.shift_staffs ss WHERE ss.shift_id=s.id
    ),'{}'::jsonb)) FROM public.shifts s WHERE s.id=p_shift_id;
$$;
REVOKE ALL ON FUNCTION private.shift_notification_snapshot(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Seed without sending historical assignment notifications during an upgrade.
INSERT INTO private.shift_notification_state(shift_id,organization_id,snapshot)
SELECT id,organization_id,private.shift_notification_snapshot(id) FROM public.shifts;

CREATE FUNCTION private.queue_shift_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
  IF TG_TABLE_NAME='shifts' THEN
    sid:=NEW.id;
    IF TG_OP='UPDATE' AND NEW.start_at IS NOT DISTINCT FROM OLD.start_at
      AND NEW.end_at IS NOT DISTINCT FROM OLD.end_at AND NEW.status IS NOT DISTINCT FROM OLD.status
      AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
  ELSE
    sid:=CASE WHEN TG_OP='DELETE' THEN OLD.shift_id ELSE NEW.shift_id END;
  END IF;
  INSERT INTO private.shift_notification_state(shift_id,organization_id,actor_id)
    SELECT s.id,s.organization_id,auth.uid() FROM public.shifts s WHERE s.id=sid
  ON CONFLICT(shift_id) DO UPDATE SET actor_id=auth.uid(),occurrence=gen_random_uuid();
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.queue_shift_notification() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER shifts_queue_business_notification AFTER INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION private.queue_shift_notification();
CREATE TRIGGER shift_staffs_queue_business_notification AFTER INSERT OR UPDATE OR DELETE ON public.shift_staffs
FOR EACH ROW EXECUTE FUNCTION private.queue_shift_notification();

CREATE FUNCTION private.flush_shift_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  state private.shift_notification_state%ROWTYPE;
  current_snapshot jsonb;
  recipient record;
  was_assigned boolean;
  is_assigned boolean;
  time_changed boolean;
  status_event text;
BEGIN
  SELECT * INTO state FROM private.shift_notification_state WHERE shift_id=NEW.shift_id FOR UPDATE;
  current_snapshot:=private.shift_notification_snapshot(state.shift_id);
  IF current_snapshot IS NULL OR current_snapshot=state.snapshot THEN RETURN NEW; END IF;
  -- Multiple queued row triggers in the same RPC compare once against the final
  -- state, including delete/reinsert of the same segment staff. Never notify an
  -- intermediate empty staff set or create transient unassigned/assigned pairs.
  IF state.actor_id IS NOT NULL AND NOT COALESCE((current_snapshot->>'deleted')::boolean,false)
    AND EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=state.organization_id AND user_id=state.actor_id) THEN
    time_changed:=state.snapshot <> '{}'::jsonb AND (
      state.snapshot->'start_at' IS DISTINCT FROM current_snapshot->'start_at'
      OR state.snapshot->'end_at' IS DISTINCT FROM current_snapshot->'end_at');
    status_event:=CASE
      WHEN state.snapshot->>'status' IS DISTINCT FROM 'cancelled' AND current_snapshot->>'status'='cancelled'
        AND state.snapshot <> '{}'::jsonb THEN 'shift.cancelled'
      WHEN state.snapshot->>'status'='cancelled' AND current_snapshot->>'status'='published' THEN 'shift.reopened'
    END;
    FOR recipient IN
      SELECT st.id,st.user_id FROM public.staffs st
      JOIN private.report_workflow_recipients(state.organization_id) eligible ON eligible=st.user_id
      WHERE st.organization_id=state.organization_id AND st.deleted_at IS NULL AND st.user_id<>state.actor_id
        AND (COALESCE(state.snapshot->'staffs','{}'::jsonb) ? st.id::text OR current_snapshot->'staffs' ? st.id::text)
    LOOP
      was_assigned:=COALESCE(state.snapshot->'staffs','{}'::jsonb) ? recipient.id::text;
      is_assigned:=current_snapshot->'staffs' ? recipient.id::text;
      IF is_assigned AND NOT was_assigned THEN
        PERFORM private.create_notification(recipient.user_id,state.organization_id,'shift.assigned',state.shift_id,state.actor_id,state.occurrence);
      ELSIF was_assigned AND NOT is_assigned THEN
        PERFORM private.create_notification(recipient.user_id,state.organization_id,'shift.unassigned',state.shift_id,state.actor_id,state.occurrence);
      END IF;
      IF is_assigned AND (time_changed OR (was_assigned AND
        state.snapshot->'staffs'->recipient.id::text IS DISTINCT FROM current_snapshot->'staffs'->recipient.id::text)) THEN
        PERFORM private.create_notification(recipient.user_id,state.organization_id,'shift.time_changed',state.shift_id,state.actor_id,state.occurrence);
      END IF;
      IF is_assigned AND status_event IS NOT NULL THEN
        PERFORM private.create_notification(recipient.user_id,state.organization_id,status_event,state.shift_id,state.actor_id,state.occurrence);
      END IF;
    END LOOP;
  END IF;
  UPDATE private.shift_notification_state SET snapshot=current_snapshot WHERE shift_id=state.shift_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notification_creation_failed: shift (required)';
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION private.flush_shift_notifications() FROM PUBLIC, anon, authenticated, service_role;
CREATE CONSTRAINT TRIGGER shift_notifications_after_insert AFTER INSERT ON private.shift_notification_state
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.flush_shift_notifications();
CREATE CONSTRAINT TRIGGER shift_notifications_after_update AFTER UPDATE ON private.shift_notification_state
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.occurrence IS DISTINCT FROM NEW.occurrence)
EXECUTE FUNCTION private.flush_shift_notifications();

-- Normal editing previously committed segments before updating the parent.
-- Keep both updates (and required notifications) inside the existing authorization
-- boundary. No new staff, client, session or permission bypass is introduced.
CREATE FUNCTION public.update_shift_with_segments_atomic(p_org_id uuid,p_shift_id uuid,p_update jsonb,p_segments jsonb)
RETURNS TABLE(id uuid,organization_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF private.get_member_shift_action_scope(p_org_id,auth.uid(),'edit')<>'all' THEN RAISE EXCEPTION 'shift edit permission required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shifts s WHERE s.id=p_shift_id AND s.organization_id=p_org_id
    AND s.deleted_at IS NULL AND private.can_access_shift(s.id) FOR UPDATE) THEN RAISE EXCEPTION 'shift not found'; END IF;
  IF jsonb_typeof(p_update) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid shift update'; END IF;
  IF p_update ? 'client_id' AND NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=(p_update->>'client_id')::uuid
    AND c.organization_id=p_org_id AND c.deleted_at IS NULL AND private.can_access_client(c.id)) THEN RAISE EXCEPTION 'client access denied'; END IF;
  PERFORM public.replace_shift_segments(p_org_id,p_shift_id,p_segments);
  UPDATE public.shifts s SET
    client_id=CASE WHEN p_update ? 'client_id' THEN (p_update->>'client_id')::uuid ELSE s.client_id END,
    start_at=CASE WHEN p_update ? 'start_at' THEN (p_update->>'start_at')::timestamptz ELSE s.start_at END,
    end_at=CASE WHEN p_update ? 'end_at' THEN (p_update->>'end_at')::timestamptz ELSE s.end_at END,
    status=CASE WHEN p_update ? 'status' THEN p_update->>'status' ELSE s.status END,
    cancel_reason=CASE WHEN p_update ? 'cancel_reason' THEN p_update->>'cancel_reason' ELSE s.cancel_reason END,
    is_modified=COALESCE((p_update->>'is_modified')::boolean,true),updated_at=statement_timestamp(),
    google_sync_status='pending_upsert',google_sync_error=NULL,google_synced_at=NULL
  WHERE s.id=p_shift_id AND s.organization_id=p_org_id AND s.deleted_at IS NULL;
  PERFORM public.refresh_shift_title(p_shift_id);
  RETURN QUERY SELECT s.id,s.organization_id FROM public.shifts s WHERE s.id=p_shift_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_shift_with_segments_atomic(uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_shift_with_segments_atomic(uuid,uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
