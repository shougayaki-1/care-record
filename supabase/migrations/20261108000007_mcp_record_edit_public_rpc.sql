-- Browser RPCs are bound to a verified session and perform all authorization
-- in the private implementation. MCP may create proposals but cannot confirm.
create function public.prepare_mcp_record_edit(p_org uuid,p_report uuid,p_expected_version bigint,p_values jsonb,p_reason text,p_changes jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_expires timestamptz;
begin
  v_id := private.prepare_mcp_record_edit(p_org,p_report,p_expected_version,p_values,p_reason,p_changes);
  select expires_at into v_expires from private.mcp_record_edit_proposals where id = v_id and actor_id = auth.uid();
  return jsonb_build_object('status','confirmation_required','proposal_id',v_id,'expires_at',v_expires);
end $$;
revoke all on function public.prepare_mcp_record_edit(uuid,uuid,bigint,jsonb,text,jsonb) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.prepare_mcp_record_edit(uuid,uuid,bigint,jsonb,text,jsonb) to mcp_import;

create function public.get_mcp_record_edit_result(p_org uuid,p_proposal uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare p private.mcp_record_edit_proposals%rowtype; r public.reports%rowtype;
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform private.assert_mcp_record_read(p_org);
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  lock table public.clients,public.form_templates,public.staffs,public.staff_roles,public.service_types,public.reports,public.report_values,public.report_actual_staffs in share mode;
  perform private.assert_mcp_record_read(p_org);
  if not exists (select 1 from private.mcp_record_edit_controls where organization_id = p_org and enabled) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  select * into p from private.mcp_record_edit_proposals where id=p_proposal and organization_id=p_org
    and actor_id=auth.uid() and oauth_client_id::text=auth.jwt()->>'client_id'
    and oauth_session_id::text=auth.jwt()->>'session_id';
  if not found then return null; end if;
  select r0.* into r from public.reports r0 join public.clients c on c.id=r0.client_id
    where r0.id=p.report_id and c.organization_id=p_org and r0.deleted_at is null;
  if not found or not private.can_access_report(p.report_id)
    or not private.can_record_action_for_client(p_org,r.client_id,'view')
    or not private.can_record_action_for_client(p_org,r.client_id,'edit') then return null; end if;
  if p.confirmed_at is not null then return p.result; end if;
  if p.expires_at <= clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if r.current_version is distinct from p.expected_version
    or r.current_revision_id is distinct from p.expected_revision_id
    or private.mcp_record_edit_snapshot(p_org,p.report_id) is distinct from p.original_snapshot
    or private.mcp_record_edit_references(p_org,p.report_id,p.proposed_content) is distinct from p.reference_content then
    return jsonb_build_object('status','changed');
  end if;
  return jsonb_build_object('status','confirmation_required');
end $$;
revoke all on function public.get_mcp_record_edit_result(uuid,uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_record_edit_result(uuid,uuid) to mcp_import;

create function public.get_mcp_record_edit_review(p_proposal uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.get_mcp_record_edit_review(p_proposal)
$$;
revoke all on function public.get_mcp_record_edit_review(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_record_edit_review(uuid) to authenticated;

create function public.confirm_mcp_record_edit(p_proposal uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.confirm_mcp_record_edit(p_proposal)
$$;
revoke all on function public.confirm_mcp_record_edit(uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.confirm_mcp_record_edit(uuid) to authenticated;

create function public.list_mcp_record_correction_proposals(p_org uuid,p_limit integer default 20,p_offset integer default 0)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.list_mcp_record_correction_proposals(p_org,p_limit,p_offset)
$$;
revoke all on function public.list_mcp_record_correction_proposals(uuid,integer,integer) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.list_mcp_record_correction_proposals(uuid,integer,integer) to authenticated;
notify pgrst, 'reload schema';
