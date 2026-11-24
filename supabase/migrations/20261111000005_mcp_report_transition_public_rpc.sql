-- The MCP role can propose and inspect the result; only an authenticated app
-- session can review and confirm. The internal functions recheck authorization.
create function public.prepare_mcp_report_transition(p_org uuid,p_report uuid,p_expected_version bigint,p_transition text,p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_expires timestamptz;
begin
  v_id := private.prepare_mcp_report_transition(p_org,p_report,p_expected_version,p_transition,p_reason);
  select expires_at into v_expires from private.mcp_report_transition_proposals where id=v_id and actor_id=auth.uid();
  return jsonb_build_object('status','confirmation_required','proposal_id',v_id,'expires_at',v_expires);
end $$;
revoke all on function public.prepare_mcp_report_transition(uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.prepare_mcp_report_transition(uuid,uuid,bigint,text,text) to mcp_import;

create function public.get_mcp_report_transition_result(p_org uuid,p_proposal uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare p private.mcp_report_transition_proposals%rowtype; r public.reports%rowtype; v_refs jsonb;
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform private.assert_mcp_record_read(p_org);
  perform 1 from public.organizations where id=p_org and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  lock table public.clients,public.reports,public.report_values,public.report_actual_staffs in share mode;
  perform private.assert_mcp_record_read(p_org);
  if not exists(select 1 from private.mcp_report_transition_controls where organization_id=p_org and enabled)
    or private.has_management_permission(p_org,auth.uid(),'reports') is distinct from true then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into p from private.mcp_report_transition_proposals where id=p_proposal and organization_id=p_org
    and actor_id=auth.uid() and oauth_client_id::text=auth.jwt()->>'client_id'
    and oauth_session_id::text=auth.jwt()->>'session_id';
  if not found then return null; end if;
  select r0.* into r from public.reports r0 join public.clients c on c.id=r0.client_id
    where r0.id=p.report_id and c.organization_id=p_org and c.deleted_at is null and r0.deleted_at is null;
  if not found or private.can_access_report(p.report_id) is distinct from true
    or private.can_record_action_for_client(p_org,r.client_id,'view') is distinct from true
    or private.can_record_action_for_client(p_org,r.client_id,'approve') is distinct from true then return null; end if;
  if p.confirmed_at is not null then return p.result; end if;
  if p.expires_at <= clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  select jsonb_build_object('organization', jsonb_build_object('id',o.id,'name',o.name),
    'client', jsonb_build_object('id',c.id,'name',c.name),
    'report', jsonb_build_object('id',r.id,'service_date',r.service_date,
      'start_at',r.start_at,'end_at',r.end_at,'status',r.status)) into v_refs
    from public.clients c join public.organizations o on o.id=c.organization_id
    where c.id=r.client_id and c.organization_id=p_org and c.deleted_at is null and o.deleted_at is null;
  if r.current_version is distinct from p.expected_version or r.current_revision_id is distinct from p.expected_revision_id
    or private.mcp_record_edit_snapshot(p_org,p.report_id) is distinct from p.original_snapshot
    or v_refs is distinct from p.reference_content then
    return jsonb_build_object('status','changed');
  end if;
  return jsonb_build_object('status','confirmation_required');
end $$;
revoke all on function public.get_mcp_report_transition_result(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_report_transition_result(uuid,uuid) to mcp_import;

create function public.get_mcp_report_transition_review(p_proposal uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.review_mcp_report_transition(p_proposal,false)
$$;
revoke all on function public.get_mcp_report_transition_review(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_report_transition_review(uuid) to authenticated;

create function public.confirm_mcp_report_transition(p_proposal uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select private.review_mcp_report_transition(p_proposal,true)
$$;
revoke all on function public.confirm_mcp_report_transition(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.confirm_mcp_report_transition(uuid) to authenticated;
notify pgrst, 'reload schema';
