-- Issue #62. Notification delivery never replaces sync/audit/backup state.
-- Private bookkeeping holds no PHI and is not an audit record or a client API.
CREATE TABLE private.google_sync_failure_episodes (
  shift_id uuid PRIMARY KEY REFERENCES public.shifts(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  episode_id uuid
);
ALTER TABLE private.google_sync_failure_episodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.google_sync_failure_episodes FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.failure_notification_recipients(p_org_id uuid, p_event_type text)
RETURNS TABLE(user_id uuid, organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.user_id, m.organization_id
  FROM public.organization_members m
  JOIN public.organizations o ON o.id=m.organization_id AND o.deleted_at IS NULL
  JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL AND p.role IS DISTINCT FROM 'super_admin'
  JOIN auth.users u ON u.id=m.user_id AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
  WHERE (p_org_id IS NULL OR m.organization_id=p_org_id)
    AND CASE p_event_type
      WHEN 'google_calendar.sync_failed' THEN private.get_member_shift_action_scope(m.organization_id,m.user_id,'edit')='all'
        AND private.get_member_shift_action_scope(m.organization_id,m.user_id,'view')='all'
      WHEN 'backup.failed' THEN private.has_management_permission(m.organization_id,m.user_id,'backupStatus')
      ELSE false
    END;
$$;
REVOKE ALL ON FUNCTION private.failure_notification_recipients(uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.notify_google_sync_failure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE episode uuid; recipient record;
BEGIN
  IF NEW.google_sync_status='synced' THEN
    UPDATE private.google_sync_failure_episodes SET episode_id=NULL WHERE shift_id=NEW.id;
  ELSIF NEW.google_sync_status='failed' THEN
    INSERT INTO private.google_sync_failure_episodes AS episodes(shift_id,organization_id,episode_id)
      VALUES(NEW.id,NEW.organization_id,gen_random_uuid())
      ON CONFLICT(shift_id) DO UPDATE SET episode_id=coalesce(episodes.episode_id,EXCLUDED.episode_id)
      RETURNING episode_id INTO episode;
    -- Keep the occurrence even if delivery fails, so a retry can finish delivery.
    BEGIN
      FOR recipient IN SELECT * FROM private.failure_notification_recipients(NEW.organization_id,'google_calendar.sync_failed') LOOP
        BEGIN
          PERFORM private.create_notification(recipient.user_id,NEW.organization_id,'google_calendar.sync_failed',NULL,NULL,episode);
        EXCEPTION WHEN OTHERS THEN
          RAISE LOG 'notification_creation_failed: google_calendar.sync_failed';
        END;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'notification_creation_failed: google_calendar.sync_failed';
    END;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A bookkeeping outage must not roll back the authoritative sync status.
  RAISE LOG 'notification_episode_failed: google_calendar.sync_failed';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_google_sync_failure() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER shifts_failure_notification AFTER INSERT OR UPDATE OF google_sync_status ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION private.notify_google_sync_failure();

-- A repair can fail while listing the calendar, before any shift is processed.
CREATE TABLE private.google_calendar_failure_episodes (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  episode_id uuid
);
ALTER TABLE private.google_calendar_failure_episodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.google_calendar_failure_episodes FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.mark_google_calendar_sync_result(p_org_id uuid,p_failed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE episode uuid; recipient record;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_session_active() THEN RAISE EXCEPTION 'authentication_required'; END IF;
  IF NOT private.is_org_member(p_org_id) OR private.get_member_shift_action_scope(p_org_id,auth.uid(),'edit')<>'all' THEN
    RAISE EXCEPTION 'shift_sync_permission_required';
  END IF;
  IF p_failed IS NULL THEN RAISE EXCEPTION 'invalid_sync_result'; END IF;
  BEGIN
    IF NOT p_failed THEN
      UPDATE private.google_calendar_failure_episodes SET episode_id=NULL WHERE organization_id=p_org_id;
      RETURN;
    END IF;
    INSERT INTO private.google_calendar_failure_episodes AS episodes(organization_id,episode_id)
      VALUES(p_org_id,gen_random_uuid())
      ON CONFLICT(organization_id) DO UPDATE SET episode_id=coalesce(episodes.episode_id,EXCLUDED.episode_id)
      RETURNING episode_id INTO episode;
    FOR recipient IN SELECT * FROM private.failure_notification_recipients(p_org_id,'google_calendar.sync_failed') LOOP
      BEGIN
        PERFORM private.create_notification(recipient.user_id,p_org_id,'google_calendar.sync_failed',NULL,NULL,episode);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'notification_creation_failed: google_calendar.sync_failed';
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'notification_episode_failed: google_calendar.sync_failed';
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_google_calendar_sync_result(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_google_calendar_sync_result(uuid,boolean) TO authenticated;

-- Existing backup backend client only; never available to a browser session.
CREATE FUNCTION public.get_backup_notification_recipients(p_org_id uuid DEFAULT NULL)
RETURNS TABLE(user_id uuid, organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT * FROM private.failure_notification_recipients(p_org_id,'backup.failed');
$$;
REVOKE ALL ON FUNCTION public.get_backup_notification_recipients(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_backup_notification_recipients(uuid) TO service_role;

-- Validate current permission again at delivery, including a revocation between
-- recipient selection and creation. Preserve the bounded adapter from #59.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid, p_event_type text, p_organization_id uuid DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL, p_actor_id uuid DEFAULT NULL, p_dedupe_key uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_event_type IS DISTINCT FROM 'backup.failed' THEN
    RAISE EXCEPTION 'notification_requires_business_rpc' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_backup_notification_recipients(p_organization_id) r WHERE r.user_id=p_user_id) THEN
    RAISE EXCEPTION 'notification_recipient_permission_required' USING ERRCODE='42501';
  END IF;
  RETURN private.create_notification(p_user_id,p_organization_id,p_event_type,p_resource_id,p_actor_id,p_dedupe_key);
END;
$$;
REVOKE ALL ON FUNCTION public.create_notification(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid,text,uuid,uuid,uuid,uuid) TO service_role;

-- Full logical backup already has a direct backend DB connection. Do not add a
-- service-role secret or another external notification endpoint for that job.
CREATE FUNCTION private.notify_full_backup_failure(p_run_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient record; episode uuid;
BEGIN
  IF p_run_id IS NULL OR p_run_id !~ '^[0-9]{1,20}$' THEN RAISE EXCEPTION 'invalid_backup_run'; END IF;
  episode := md5('backup.failed:full:' || p_run_id)::uuid;
  FOR recipient IN SELECT * FROM private.failure_notification_recipients(NULL,'backup.failed') LOOP
    BEGIN
      PERFORM private.create_notification(recipient.user_id,recipient.organization_id,'backup.failed',NULL,NULL,episode);
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'notification_creation_failed: backup.failed';
    END;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_full_backup_failure(text) FROM PUBLIC, anon, authenticated, service_role;
