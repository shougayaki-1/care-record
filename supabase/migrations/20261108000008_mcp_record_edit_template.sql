-- Expose the values and linked identities that an authorized MCP user must
-- preserve when proposing changes. Access is limited to an enabled feature,
-- current OAuth session, membership and the existing record permissions.
create function public.get_mcp_record_edit_template(p_org uuid,p_report uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.reports%rowtype; v_values jsonb; v_actual jsonb; v_after jsonb; v_refs jsonb;
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform private.assert_mcp_record_read(p_org);
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  lock table public.clients,public.form_templates,public.staffs,public.staff_roles,public.service_types,public.reports,public.report_values,public.report_actual_staffs in share mode;
  perform private.assert_mcp_record_read(p_org);
  if not exists(select 1 from private.mcp_record_edit_controls where organization_id=p_org and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select r0.* into r from public.reports r0 join public.clients c on c.id=r0.client_id
    where r0.id=p_report and c.organization_id=p_org and r0.deleted_at is null;
  if not found or r.status is null or r.status not in ('draft','approved') or not private.can_access_report(r.id)
    or not private.can_record_action_for_client(p_org,r.client_id,'view')
    or not private.can_record_action_for_client(p_org,r.client_id,'edit') then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select data into v_values from public.report_values where report_id=r.id;
  if not found then v_values := '{}'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('staff_id',s.staff_id,'staff_role_id',s.staff_role_id) order by s.sort_order,s.id),'[]'::jsonb)
    into v_actual from public.report_actual_staffs s where s.report_id=r.id;
  if v_values is null or jsonb_typeof(v_values) is distinct from 'object' then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  v_after := jsonb_build_object('actual_staffs',v_actual,'actual_service_type_id',r.actual_service_type_id);
  v_refs := private.mcp_record_edit_references(p_org,r.id,v_after);
  if v_refs is null or not private.is_mcp_oauth_active() then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p_org,auth.uid(),auth.jwt()->>'session_id','report.view','report',r.id::text,'success',jsonb_build_object('source','mcp_record_edit_template'));
  return jsonb_build_object('record_id',r.id,'current_version',r.current_version,'status',r.status,'values',v_values,
    'start_at',r.start_at,'end_at',r.end_at,'actual_service_type_id',r.actual_service_type_id,'actual_staffs',v_actual,'references',v_refs);
end $$;
revoke all on function public.get_mcp_record_edit_template(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_record_edit_template(uuid,uuid) to mcp_import;
notify pgrst, 'reload schema';
