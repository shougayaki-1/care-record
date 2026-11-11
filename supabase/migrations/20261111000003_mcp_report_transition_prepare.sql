-- Internal only until the complete confirmation flow is available.
create function private.prepare_mcp_report_transition(
  p_org uuid, p_report uuid, p_expected_version bigint, p_transition text, p_reason text
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.reports%rowtype;
  v_id uuid;
  v_snapshot bytea;
  v_references jsonb;
begin
  if p_org is null or p_report is null or p_expected_version is null or p_expected_version < 0
    or p_transition is null or p_transition not in ('approve', 'remand')
    or (p_transition = 'approve' and p_reason is not null)
    or (p_transition = 'remand' and (p_reason is null or char_length(btrim(p_reason)) not between 1 and 500)) then
    raise exception 'invalid_report_transition' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform private.assert_mcp_record_read(p_org);
  perform 1 from public.organizations where id = p_org and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  perform 1 from public.organization_members where organization_id = p_org and user_id = auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  lock table public.organization_member_roles, public.organization_roles, public.assignments in share mode;
  lock table public.clients, public.reports, public.report_values, public.report_actual_staffs in share mode;
  perform private.assert_mcp_record_read(p_org);
  if not exists (select 1 from private.mcp_report_transition_controls where organization_id = p_org and enabled)
    or private.has_management_permission(p_org, auth.uid(), 'reports') is distinct from true then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  select r0.* into r from public.reports r0 join public.clients c on c.id = r0.client_id
    where r0.id = p_report and c.organization_id = p_org and c.deleted_at is null and r0.deleted_at is null;
  if not found or private.can_access_report(p_report) is distinct from true
    or private.can_record_action_for_client(p_org, r.client_id, 'view') is distinct from true
    or private.can_record_action_for_client(p_org, r.client_id, 'approve') is distinct from true
    or (p_transition = 'approve' and (r.status is null or r.status not in ('pending', 'remanded')))
    or (p_transition = 'remand' and r.status is distinct from 'approved') then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  if r.current_version is distinct from p_expected_version then
    raise exception 'proposal_changed' using errcode = '22023';
  end if;
  select jsonb_build_object('organization', jsonb_build_object('id', o.id, 'name', o.name),
    'client', jsonb_build_object('id', c.id, 'name', c.name),
    'report', jsonb_build_object('id', r.id, 'service_date', r.service_date,
      'start_at', r.start_at, 'end_at', r.end_at, 'status', r.status)) into v_references
    from public.clients c join public.organizations o on o.id = c.organization_id
    where c.id = r.client_id and c.organization_id = p_org and c.deleted_at is null and o.deleted_at is null;
  v_snapshot := private.mcp_record_edit_snapshot(p_org, p_report);
  perform pg_advisory_xact_lock(hashtextextended('mcp_report_transition:' || auth.uid()::text, 0));
  if (select count(*) from private.mcp_report_transition_proposals
      where actor_id = auth.uid() and created_at > clock_timestamp() - interval '1 hour') >= 50 then
    raise exception 'proposal_limit' using errcode = '54000';
  end if;
  if v_snapshot is null or v_references is null or not private.is_mcp_oauth_active() then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  insert into private.mcp_report_transition_proposals (
    organization_id, actor_id, oauth_client_id, oauth_session_id, report_id,
    expected_version, expected_revision_id, original_snapshot, reference_content, transition, reason
  ) values (
    p_org, auth.uid(), (auth.jwt()->>'client_id')::uuid, (auth.jwt()->>'session_id')::uuid,
    p_report, p_expected_version, r.current_revision_id, v_snapshot, v_references,
    p_transition, case when p_transition = 'remand' then btrim(p_reason) else null end
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function private.prepare_mcp_report_transition(uuid,uuid,bigint,text,text)
  from public, anon, authenticated, service_role, mcp_import;
