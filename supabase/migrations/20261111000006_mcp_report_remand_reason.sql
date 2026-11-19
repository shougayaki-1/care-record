-- Expose only the reason attached to the current remand, to a user
-- who can already view that report. Older reasons never stand in for a later
-- unrelated remand, and the reason is excluded from logs and audit details.
create function public.get_mcp_report_remand_reason(p_org uuid,p_report uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_reason text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active()
    or not private.is_org_member(p_org) then raise exception 'permission_denied' using errcode='42501'; end if;
  select p.reason into v_reason from public.reports r
    join public.clients c on c.id=r.client_id
    join private.mcp_report_status_epochs e on e.report_id=r.id
    join private.mcp_report_transition_proposals p on p.report_id=r.id and p.organization_id=p_org and p.status_epoch=e.epoch
    where r.id=p_report and c.organization_id=p_org and c.deleted_at is null and r.deleted_at is null
      and r.status='remanded' and p.transition='remand' and p.confirmed_at is not null
      and private.can_access_report(r.id) and private.can_record_action_for_client(p_org,c.id,'view')
    order by p.confirmed_at desc,p.id desc limit 1;
  if v_reason is not null then
    insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
      values(p_org,auth.uid(),auth.jwt()->>'session_id','report.view','report',p_report::text,'success',
        jsonb_build_object('source','mcp_remand_reason'));
  end if;
  return v_reason;
end $$;
revoke all on function public.get_mcp_report_remand_reason(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_report_remand_reason(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
