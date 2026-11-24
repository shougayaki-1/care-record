-- The review payload is internal until a human-facing screen is available.
-- Accessing record content is audited without logging the values themselves.
create function private.get_mcp_record_edit_review(p_proposal uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare p private.mcp_record_edit_proposals%rowtype; r public.reports%rowtype;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  select * into p from private.mcp_record_edit_proposals where id = p_proposal and actor_id = auth.uid();
  if not found then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  if p.confirmed_at is null and not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id) then
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
    or (p.confirmed_at is null and (
      not exists (select 1 from private.mcp_record_edit_controls where organization_id = p.organization_id and enabled)
      or not exists (select 1 from private.mcp_record_read_controls where organization_id = p.organization_id and enabled))) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  lock table public.clients, public.form_templates, public.staffs, public.staff_roles, public.service_types, public.reports, public.report_values, public.report_actual_staffs in share mode;
  select r0.* into r from public.reports r0 join public.clients c on c.id = r0.client_id
    where r0.id = p.report_id and c.organization_id = p.organization_id and r0.deleted_at is null;
  if not found or not private.can_access_report(p.report_id)
    or not private.can_record_action_for_client(p.organization_id,r.client_id,'view')
    or not private.can_record_action_for_client(p.organization_id,r.client_id,'edit')
    or not private.is_session_active()
    or (p.confirmed_at is null and not private.mcp_shift_update_oauth_valid(p.actor_id,p.oauth_client_id,p.oauth_session_id)) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  if p.confirmed_at is not null then
    if p.result->>'status' = 'correction_proposed' then
      insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
        values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','report.view','report',p.report_id::text,'success',
          jsonb_build_object('source','mcp_correction_review','proposal_id',p.id));
      return p.result || jsonb_build_object('proposal_id',p.id,'confirmed_at',p.confirmed_at,
        'references',p.reference_content,'before',p.before_content,'proposal',p.proposed_content,'reason',p.reason,
        'base_changed',r.current_version is distinct from p.expected_version
          or r.current_revision_id is distinct from p.expected_revision_id
          or private.mcp_record_edit_snapshot(p.organization_id,p.report_id) is distinct from p.original_snapshot
          or private.mcp_record_edit_references(p.organization_id,p.report_id,p.proposed_content) is distinct from p.reference_content);
    end if;
    return p.result;
  end if;
  if p.expires_at <= clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if r.current_version is distinct from p.expected_version
    or r.current_revision_id is distinct from p.expected_revision_id
    or private.mcp_record_edit_snapshot(p.organization_id,p.report_id) is distinct from p.original_snapshot
    or private.mcp_record_edit_references(p.organization_id,p.report_id,p.proposed_content) is distinct from p.reference_content then
    return jsonb_build_object('status','changed');
  end if;
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(p.organization_id,auth.uid(),auth.jwt()->>'session_id','report.view','report',p.report_id::text,'success',
      jsonb_build_object('source','mcp_confirmation','proposal_id',p.id));
  return jsonb_build_object('status','confirmation_required','proposal_id',p.id,'expires_at',p.expires_at,
    'references',p.reference_content,'before',p.before_content,'proposal',p.proposed_content,'reason',p.reason,
    'expected_version',p.expected_version);
end $$;
revoke all on function private.get_mcp_record_edit_review(uuid)
  from public, anon, authenticated, service_role, mcp_import;
