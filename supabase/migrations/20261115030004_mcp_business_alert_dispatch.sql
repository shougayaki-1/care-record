-- Internal bounded dispatcher: an eventual scheduler must call with the real
-- server clock. It is deliberately not granted to any application role.
create function private.dispatch_mcp_business_alerts(p_now timestamptz,p_limit integer default 1000,p_after_org uuid default null,p_after_user uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_sub record; v_current private.mcp_business_alert_subscriptions%rowtype; v_day date; v_period date;
  v_scope text; v_event text; v_occurrence uuid; v_notification uuid; v_count integer := 0; v_scanned integer := 0; v_needed boolean; v_last_org uuid; v_last_user uuid;
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 1000 or ((p_after_org is null) <> (p_after_user is null)) then raise exception 'invalid_alert_dispatch' using errcode='22023'; end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  v_day := (p_now at time zone 'Asia/Tokyo')::date;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  for v_sub in select organization_id,user_id from private.mcp_business_alert_subscriptions where enabled and (p_after_org is null or (organization_id,user_id) > (p_after_org,p_after_user)) order by organization_id,user_id limit p_limit loop
    v_scanned := v_scanned + 1; v_last_org := v_sub.organization_id; v_last_user := v_sub.user_id;
    perform 1 from public.organizations where id=v_sub.organization_id and deleted_at is null for share;
    if not found then continue; end if;
    perform 1 from public.organization_members where organization_id=v_sub.organization_id and user_id=v_sub.user_id for share;
    if not found then continue; end if;
    select * into v_current from private.mcp_business_alert_subscriptions where organization_id=v_sub.organization_id and user_id=v_sub.user_id for update;
    if not found or not v_current.enabled or not exists(select 1 from private.report_workflow_recipients(v_sub.organization_id) x where x=v_sub.user_id) then continue; end if;
    v_period := case when v_current.frequency='weekly' then date_trunc('week',v_day::timestamp)::date else v_day end;
    foreach v_event in array array['business.pending_reports','business.unassigned_shifts'] loop
      v_needed := false;
      if v_event='business.pending_reports' and v_current.pending_reports
        and private.has_management_permission(v_sub.organization_id,v_sub.user_id,'reports') then
        v_scope := private.get_member_record_action_scope(v_sub.organization_id,v_sub.user_id,'approve');
        if v_scope in ('all','assigned') then
          select exists(select 1 from public.reports r join public.clients c on c.id=r.client_id
            where c.organization_id=v_sub.organization_id and c.deleted_at is null and r.deleted_at is null and r.status in ('pending','remanded')
              and (v_scope='all' or private.is_assigned_client_for_user(c.id,v_sub.organization_id,v_sub.user_id))) into v_needed;
        end if;
      elsif v_event='business.unassigned_shifts' and v_current.unassigned_shifts
        and private.get_member_shift_action_scope(v_sub.organization_id,v_sub.user_id,'view')='all' then
        select exists(select 1 from public.shifts s where s.organization_id=v_sub.organization_id and s.deleted_at is null
          and s.status is distinct from 'cancelled' and s.start_at>=p_now and s.start_at<p_now+interval '7 days'
          and not exists(select 1 from public.shift_staffs x where x.shift_id=s.id)
          and not exists(select 1 from public.shift_segments t join public.shift_segment_staffs x on x.segment_id=t.id where t.shift_id=s.id)) into v_needed;
      end if;
      if v_needed then
        v_occurrence := null;
        insert into private.mcp_business_alert_occurrences(organization_id,user_id,event_type,period_start,delivery_day,frequency)
          values(v_sub.organization_id,v_sub.user_id,v_event,v_period,v_day,v_current.frequency)
          on conflict do nothing returning id into v_occurrence;
        if v_occurrence is not null then
          v_notification := private.create_notification(v_sub.user_id,v_sub.organization_id,v_event,null,null,v_occurrence);
          if v_notification is null then raise exception 'notification_creation_failed'; end if;
          v_count := v_count + 1;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('created',v_count,'scanned',v_scanned,'next_org',v_last_org,'next_user',v_last_user);
end $$;
revoke all on function private.dispatch_mcp_business_alerts(timestamptz,integer,uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
