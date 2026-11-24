-- Internal transaction only. A public confirmation RPC must not be granted
-- until the human review screen and proposal retrieval flow exist.
create function private.confirm_mcp_record_edit(p_proposal uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  p private.mcp_record_edit_proposals%rowtype; r public.reports%rowtype;
  v_staffs jsonb; v_values jsonb; v_result jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  select * into p from private.mcp_record_edit_proposals where id = p_proposal and actor_id = auth.uid() for update;
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
    or not exists (select 1 from private.mcp_record_edit_controls where organization_id = p.organization_id and enabled)
    or not exists (select 1 from private.mcp_record_read_controls where organization_id = p.organization_id and enabled) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  lock table public.clients, public.form_templates, public.staffs, public.staff_roles, public.service_types in share mode;
  lock table public.reports, public.report_values, public.report_actual_staffs in share row exclusive mode;
  select r0.* into r from public.reports r0 join public.clients c on c.id = r0.client_id
    where r0.id = p.report_id and c.organization_id = p.organization_id and r0.deleted_at is null;
  if not found or not private.can_access_report(p.report_id)
    or not private.can_record_action_for_client(p.organization_id,r.client_id,'view')
    or not private.can_record_action_for_client(p.organization_id,r.client_id,'edit')
    or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id)
    or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  if p.confirmed_at is not null then return p.result || jsonb_build_object('replayed',true); end if;
  if p.expires_at <= clock_timestamp() then raise exception 'proposal_expired' using errcode = '22023'; end if;
  if r.current_version is distinct from p.expected_version
    or r.current_revision_id is distinct from p.expected_revision_id
    or private.mcp_record_edit_snapshot(p.organization_id,p.report_id) is distinct from p.original_snapshot
    or private.mcp_record_edit_references(p.organization_id,p.report_id,p.proposed_content) is distinct from p.reference_content then
    raise exception 'proposal_changed' using errcode = '22023';
  end if;
  -- The current app has no approved-record correction workflow. Save a
  -- confirmed proposal separately and never change the approved record or its
  -- current revision. This is not a completed correction or approval.
  if r.status = 'approved' then
    if p.expires_at <= clock_timestamp() or not private.is_session_active()
      or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
      raise exception 'proposal_expired' using errcode = '22023';
    end if;
    insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
      values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','report.correction.proposed','report',r.id::text,'success',
        jsonb_build_object('proposal_id',p.id,'source','mcp_confirmation','baseVersion',p.expected_version));
    v_result := jsonb_build_object('status','correction_proposed','report_id',r.id,
      'base_version',p.expected_version,'replayed',false);
    update private.mcp_record_edit_proposals set confirmed_at = clock_timestamp(),
      confirmed_session_id = auth.jwt()->>'session_id', result = v_result where id = p.id;
    return v_result;
  end if;
  if r.status is distinct from 'draft' or r.start_at is null or r.end_at is null then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  v_values := p.proposed_content->'values';
  v_staffs := p.proposed_content->'actual_staffs';
  if p.expires_at <= clock_timestamp() or not private.is_session_active()
    or not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
    raise exception 'proposal_expired' using errcode = '22023';
  end if;
  v_result := public.save_report_versioned(p.organization_id,r.id,r.client_id,r.shift_id,r.segment_id,
    (p.proposed_content->>'start_at')::timestamptz,(p.proposed_content->>'end_at')::timestamptz,
    'draft',v_values,p.expected_version,p.id,auth.jwt()->>'session_id',
    nullif(p.proposed_content->>'actual_service_type_id','')::uuid,v_staffs,null);
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','report.mcp_edit.confirm','report',r.id::text,'success',
      jsonb_build_object('proposal_id',p.id,'source','mcp_confirmation'));
  v_result := jsonb_build_object('status','updated','report_id',r.id,'version',v_result->'version','replayed',false);
  update private.mcp_record_edit_proposals set confirmed_at = clock_timestamp(),
    confirmed_session_id = auth.jwt()->>'session_id', result = v_result where id = p.id;
  return v_result;
end $$;
revoke all on function private.confirm_mcp_record_edit(uuid)
  from public, anon, authenticated, service_role, mcp_import;
