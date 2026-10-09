-- Hosted Production profiles has no role column. Read the optional legacy
-- marker without adding an administrator column or changing table grants.
-- With that column present, super_admin exclusion remains unchanged.
CREATE OR REPLACE FUNCTION private.failure_notification_recipients(p_org_id uuid, p_event_type text)
RETURNS TABLE(user_id uuid, organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.user_id, m.organization_id
  FROM public.organization_members m
  JOIN public.organizations o ON o.id=m.organization_id AND o.deleted_at IS NULL
  JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL AND (to_jsonb(p)->>'role') IS DISTINCT FROM 'super_admin'
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
