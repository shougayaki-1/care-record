-- Internal review/confirmation. No browser or MCP grants until the complete UI
-- and public wrappers are present. Confirmation and audit share one transaction.
create function private.review_mcp_report_transition(p_proposal uuid, p_confirm boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  p private.mcp_report_transition_proposals%rowtype;
  r public.reports%rowtype;
  v_refs jsonb;
  v_result jsonb;
  v_epoch uuid;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active()
    or p_confirm is null then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  select * into p from private.mcp_report_transition_proposals
    where id = p_proposal and actor_id = auth.uid() for update;
  if not found or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = p.organization_id and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  perform 1 from public.organization_members where organization_id = p.organization_id and user_id = auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  lock table public.organization_member_roles, public.organization_roles, public.assignments in share mode;
  perform 1 from public.user_session_activity where user_id = auth.uid() and auth_session_id = auth.jwt()->>'session_id'
    and revoked_at is null and last_activity >= clock_timestamp() - interval '24 hours'
    and absolute_expires_at > clock_timestamp() for share;
  if not found or not private.is_session_active() or not private.is_org_member(p.organization_id)
    or private.has_management_permission(p.organization_id, auth.uid(), 'reports') is distinct from true
    or not exists (select 1 from private.mcp_report_transition_controls where organization_id = p.organization_id and enabled)
    or not exists (select 1 from private.mcp_record_read_controls where organization_id = p.organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  lock table public.clients in share mode;
  lock table public.reports, public.report_values, public.report_actual_staffs in share row exclusive mode;
  select r0.* into r from public.reports r0 join public.clients c on c.id = r0.client_id
    where r0.id = p.report_id and c.organization_id = p.organization_id and c.deleted_at is null and r0.deleted_at is null;
  if not found or private.can_access_report(p.report_id) is distinct from true
    or private.can_record_action_for_client(p.organization_id, r.client_id, 'view') is distinct from true
    or private.can_record_action_for_client(p.organization_id, r.client_id, 'approve') is distinct from true
    or not private.is_session_active()
    or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  if p.confirmed_at is not null then return p.result || jsonb_build_object('replayed',true); end if;
  if p.expires_at <= clock_timestamp() then
    if p_confirm then raise exception 'proposal_expired' using errcode = '22023'; end if;
    return jsonb_build_object('status','expired');
  end if;
  select jsonb_build_object('organization', jsonb_build_object('id', o.id, 'name', o.name),
    'client', jsonb_build_object('id', c.id, 'name', c.name),
    'report', jsonb_build_object('id', r.id, 'service_date', r.service_date,
      'start_at', r.start_at, 'end_at', r.end_at, 'status', r.status)) into v_refs
    from public.clients c join public.organizations o on o.id = c.organization_id
    where c.id = r.client_id and c.organization_id = p.organization_id and c.deleted_at is null and o.deleted_at is null;
  if r.current_version is distinct from p.expected_version
    or r.current_revision_id is distinct from p.expected_revision_id
    or private.mcp_record_edit_snapshot(p.organization_id,p.report_id) is distinct from p.original_snapshot
    or v_refs is distinct from p.reference_content then
    if p_confirm then raise exception 'proposal_changed' using errcode = '22023'; end if;
    return jsonb_build_object('status','changed');
  end if;
  if not p_confirm then
    return jsonb_build_object('status','confirmation_required','proposal_id',p.id,'expires_at',p.expires_at,
      'references',p.reference_content,'transition',p.transition,'reason',p.reason,'expected_version',p.expected_version);
  end if;
  if p.expires_at <= clock_timestamp() or not private.is_session_active()
    or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_expired' using errcode = '22023';
  end if;
  perform public.transition_reports_authorized(p.organization_id,array[p.report_id],p.transition);
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','report.mcp_transition.confirm','report',p.report_id::text,'success',
      jsonb_build_object('proposal_id',p.id,'transition',p.transition,'baseVersion',p.expected_version,'source','mcp_confirmation'));
  select current_version into r.current_version from public.reports where id=p.report_id;
  select epoch into v_epoch from private.mcp_report_status_epochs where report_id=p.report_id;
  if v_epoch is null then raise exception 'transition_epoch_missing'; end if;
  v_result := jsonb_build_object('status',case when p.transition='approve' then 'approved' else 'remanded' end,
    'report_id',p.report_id,'version',r.current_version,'replayed',false);
  -- The marker is retained in the private proposal, not returned to MCP.
  update private.mcp_report_transition_proposals set confirmed_at = clock_timestamp(),
    confirmed_session_id = auth.jwt()->>'session_id', status_epoch=v_epoch, result = v_result where id = p.id;
  return v_result;
end $$;
revoke all on function private.review_mcp_report_transition(uuid,boolean)
  from public, anon, authenticated, service_role, mcp_import;
