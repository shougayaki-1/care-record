-- Preferences can only be managed by the authenticated recipient. Permission is
-- also checked again when a notification is generated.
create function public.get_mcp_business_alert_preferences(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active()
    or not private.is_org_member(p_organization_id)
    or not exists(select 1 from public.organizations where id=p_organization_id and deleted_at is null) then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  select jsonb_build_object('enabled',enabled,'frequency',frequency,'pending_reports',pending_reports,'unassigned_shifts',unassigned_shifts)
    into v_result from private.mcp_business_alert_subscriptions where organization_id=p_organization_id and user_id=auth.uid();
  return coalesce(v_result,jsonb_build_object('enabled',false,'frequency','daily','pending_reports',false,'unassigned_shifts',false));
end $$;
revoke all on function public.get_mcp_business_alert_preferences(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_business_alert_preferences(uuid) to authenticated;

create function public.set_mcp_business_alert_preferences(p_organization_id uuid,p_enabled boolean,p_frequency text,p_pending_reports boolean,p_unassigned_shifts boolean)
returns void language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if p_enabled is null or p_frequency is null or p_frequency not in ('daily','weekly') or p_pending_reports is null or p_unassigned_shifts is null
    or (p_enabled and not (p_pending_reports or p_unassigned_shifts)) then raise exception 'invalid_preferences' using errcode='22023'; end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform 1 from public.organizations where id=p_organization_id and deleted_at is null for share;
  if not found then raise exception 'permission_denied' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p_organization_id and user_id=v_user for share;
  if not found then raise exception 'permission_denied' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  perform 1 from public.user_session_activity where user_id=v_user and auth_session_id=auth.jwt()->>'session_id'
    and revoked_at is null and last_activity>=clock_timestamp()-interval '24 hours' and absolute_expires_at>clock_timestamp() for share;
  if not found or not private.is_session_active() or not private.is_org_member(p_organization_id)
    or (p_enabled and p_pending_reports and (not private.has_management_permission(p_organization_id,v_user,'reports')
      or coalesce(private.get_member_record_action_scope(p_organization_id,v_user,'approve'),'none') not in ('all','assigned')))
    or (p_enabled and p_unassigned_shifts and private.get_member_shift_action_scope(p_organization_id,v_user,'view') is distinct from 'all') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  insert into private.mcp_business_alert_subscriptions(organization_id,user_id,enabled,frequency,pending_reports,unassigned_shifts,updated_at)
    values(p_organization_id,v_user,p_enabled,p_frequency,p_pending_reports,p_unassigned_shifts,clock_timestamp())
    on conflict (organization_id,user_id) do update set enabled=excluded.enabled,frequency=excluded.frequency,
      pending_reports=excluded.pending_reports,unassigned_shifts=excluded.unassigned_shifts,updated_at=excluded.updated_at;
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p_organization_id,v_user,auth.jwt()->>'session_id','notification.business_preferences.update','organization',p_organization_id::text,'success',
      jsonb_build_object('enabled',p_enabled,'frequency',p_frequency,'pendingReports',p_pending_reports,'unassignedShifts',p_unassigned_shifts));
end $$;
revoke all on function public.set_mcp_business_alert_preferences(uuid,boolean,text,boolean,boolean) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.set_mcp_business_alert_preferences(uuid,boolean,text,boolean,boolean) to authenticated;
notify pgrst, 'reload schema';
