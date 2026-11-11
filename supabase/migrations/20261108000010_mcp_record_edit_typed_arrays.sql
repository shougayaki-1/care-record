-- Replaces the previously deployed function with explicitly typed empty arrays.
create or replace function private.prepare_mcp_record_edit(
  p_org uuid, p_report uuid, p_expected_version bigint, p_values jsonb, p_reason text, p_changes jsonb default '{}'::jsonb
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_report public.reports%rowtype; v_values jsonb; v_refs jsonb; v_snapshot bytea; v_id uuid;
  v_expenses jsonb; v_expense jsonb; v_safe_expenses jsonb := '[]'::jsonb;
  v_staff_count integer; v_staff_name text; v_staff_ids text[] := array[]::text[]; v_amount numeric; v_total numeric := 0;
  v_actual jsonb; v_before_actual jsonb; v_normal_actual jsonb := '[]'::jsonb; v_staff jsonb; v_role uuid; v_staff_id uuid; v_service uuid;
  v_start timestamptz; v_end timestamptz; v_after jsonb; v_schema jsonb; v_seen uuid[] := array[]::uuid[];
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform private.assert_mcp_record_read(p_org);
  perform 1 from public.organizations where id = p_org and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  perform 1 from public.organization_members where organization_id = p_org and user_id = auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  lock table public.organization_member_roles, public.organization_roles, public.assignments in share mode;
  lock table public.clients, public.form_templates, public.staffs, public.staff_roles, public.service_types, public.reports, public.report_values, public.report_actual_staffs in share mode;
  perform private.assert_mcp_record_read(p_org);
  if not exists (select 1 from private.mcp_record_edit_controls where organization_id = p_org and enabled) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  select r.* into v_report from public.reports r join public.clients c on c.id = r.client_id
    where r.id = p_report and c.organization_id = p_org and r.deleted_at is null;
  if not found or v_report.status is null or v_report.status not in ('draft', 'approved')
    or not private.can_access_report(p_report)
    or not private.can_record_action_for_client(p_org, v_report.client_id, 'edit') then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or v_report.current_version <> p_expected_version then
    raise exception 'proposal_changed' using errcode = '22023';
  end if;
  if jsonb_typeof(p_values) is distinct from 'object' or octet_length(p_values::text) > 1000000
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'invalid_record_proposal' using errcode = '22023';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('start_at','end_at','actual_service_type_id','actual_staffs'))
    or (p_changes ? 'start_at' and (jsonb_typeof(p_changes->'start_at') is distinct from 'string' or p_changes->>'start_at' !~ '[Tt].*([Zz]|[+-][0-9]{2}:[0-9]{2})$'))
    or (p_changes ? 'end_at' and (jsonb_typeof(p_changes->'end_at') is distinct from 'string' or p_changes->>'end_at' !~ '[Tt].*([Zz]|[+-][0-9]{2}:[0-9]{2})$'))
    or (p_changes ? 'actual_service_type_id' and (jsonb_typeof(p_changes->'actual_service_type_id') not in ('string','null')
      or (jsonb_typeof(p_changes->'actual_service_type_id')='string' and p_changes->>'actual_service_type_id'='')))
    or (p_changes ? 'actual_staffs' and jsonb_typeof(p_changes->'actual_staffs') is distinct from 'array') then
    raise exception 'invalid_record_proposal' using errcode = '22023';
  end if;
  begin
    v_start := coalesce((p_changes->>'start_at')::timestamptz,v_report.start_at);
    v_end := coalesce((p_changes->>'end_at')::timestamptz,v_report.end_at);
    v_service := case when p_changes ? 'actual_service_type_id' then nullif(p_changes->>'actual_service_type_id','')::uuid else v_report.actual_service_type_id end;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_record_proposal' using errcode = '22023';
  end;
  if v_start is null or v_end is null or v_end<=v_start
    or (v_service is not null and not exists(select 1 from public.service_types st where st.id=v_service and st.organization_id=p_org and st.deleted_at is null and (st.is_active or st.id=v_report.actual_service_type_id))) then
    raise exception 'invalid_record_proposal' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('staff_id',s.staff_id,'staff_role_id',s.staff_role_id) order by s.sort_order,s.id),'[]'::jsonb)
    into v_before_actual from public.report_actual_staffs s where s.report_id=p_report;
  v_actual := coalesce(p_changes->'actual_staffs',v_before_actual);
  if jsonb_array_length(v_actual)>20 then raise exception 'invalid_record_proposal' using errcode='22023'; end if;
  for v_staff in select value from jsonb_array_elements(v_actual) loop
    if jsonb_typeof(v_staff) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(v_staff) k where k not in ('staff_id','staff_role_id'))
      or jsonb_typeof(v_staff->'staff_id') is distinct from 'string'
      or (v_staff ? 'staff_role_id' and (jsonb_typeof(v_staff->'staff_role_id') not in ('string','null')
        or (jsonb_typeof(v_staff->'staff_role_id')='string' and v_staff->>'staff_role_id'=''))) then
      raise exception 'invalid_record_proposal' using errcode='22023';
    end if;
    begin v_staff_id := (v_staff->>'staff_id')::uuid; v_role := nullif(v_staff->>'staff_role_id','')::uuid;
    exception when invalid_text_representation then raise exception 'invalid_record_proposal' using errcode='22023'; end;
    if v_staff_id is null or v_staff_id=any(v_seen)
      or not exists(select 1 from public.staffs s where s.id=v_staff_id and s.organization_id=p_org and s.deleted_at is null
        and (s.archived_at is null or exists(select 1 from public.report_actual_staffs old where old.report_id=p_report and old.staff_id=s.id)))
      or (v_role is not null and not exists(select 1 from public.staff_roles sr where sr.id=v_role and sr.organization_id=p_org and sr.deleted_at is null
        and (sr.is_active or exists(select 1 from public.report_actual_staffs old where old.report_id=p_report and old.staff_id=v_staff_id and old.staff_role_id=sr.id)))) then
      raise exception 'invalid_record_proposal' using errcode='22023';
    end if;
    v_seen := array_append(v_seen,v_staff_id);
    v_normal_actual := v_normal_actual || jsonb_build_array(jsonb_build_object('staff_id',v_staff_id,'staff_role_id',v_role));
  end loop;
  v_actual := v_normal_actual;
  if p_changes ? 'actual_staffs' then
    select coalesce(jsonb_agg(to_jsonb(s.name) order by item.ordinality),'[]'::jsonb) into v_refs
      from jsonb_array_elements(v_actual) with ordinality item(value,ordinality)
      join public.staffs s on s.id::text=item.value->>'staff_id' and s.organization_id=p_org;
    p_values := jsonb_set(p_values,'{_helpers}',v_refs,true);
  end if;
  select v.data into v_values from public.report_values v where v.report_id = p_report;
  if not found then v_values := '{}'::jsonb; end if;
  if not (p_changes ? 'actual_staffs') and (p_values->'_helpers') is distinct from (v_values->'_helpers') then
    raise exception 'invalid_record_proposal' using errcode = '22023';
  end if;
  if v_values is null or jsonb_typeof(v_values) is distinct from 'object'
    or (p_values = v_values and v_start is not distinct from v_report.start_at and v_end is not distinct from v_report.end_at
      and v_service is not distinct from v_report.actual_service_type_id and v_actual = v_before_actual) then
    raise exception 'invalid_record_proposal' using errcode = '22023';
  end if;
  -- Validate changed travel expenses against the existing assigned staff, as
  -- saveReport does, and use server-derived names for the displayed proposal.
  if (p_values->'travel_expenses') is distinct from (v_values->'travel_expenses')
    or (p_values->'travel_cost_yen') is distinct from (v_values->'travel_cost_yen')
    or (v_actual is distinct from v_before_actual and p_values ? 'travel_expenses') then
    v_expenses := p_values->'travel_expenses';
    if jsonb_typeof(v_expenses) is distinct from 'array'
      or jsonb_typeof(p_values->'travel_cost_yen') is distinct from 'number' then
      raise exception 'invalid_record_proposal' using errcode = '22023';
    end if;
    v_staff_count := jsonb_array_length(v_actual);
    if jsonb_array_length(v_expenses) <> v_staff_count then
      raise exception 'invalid_record_proposal' using errcode = '22023';
    end if;
    for v_expense in select value from jsonb_array_elements(v_expenses) loop
      if jsonb_typeof(v_expense) is distinct from 'object'
        or jsonb_typeof(v_expense->'staff_id') is distinct from 'string'
        or jsonb_typeof(v_expense->'staff_name') is distinct from 'string'
        or char_length(v_expense->>'staff_name') > 100
        or jsonb_typeof(v_expense->'method') is distinct from 'string'
        or v_expense->>'method' not in ('car','public_transport','other','none')
        or jsonb_typeof(v_expense->'amount_yen') not in ('number','null')
        or not (v_expense ? 'amount_yen')
        or (v_expense->>'staff_id') = any(v_staff_ids) then
        raise exception 'invalid_record_proposal' using errcode = '22023';
      end if;
      select s.name into v_staff_name from public.staffs s where s.organization_id=p_org
        and s.id::text=v_expense->>'staff_id' and s.id=any(v_seen);
      if not found or v_staff_name is null then raise exception 'invalid_record_proposal' using errcode = '22023'; end if;
      v_staff_ids := array_append(v_staff_ids,v_expense->>'staff_id');
      v_amount := (v_expense->>'amount_yen')::numeric;
      if (v_amount is null and (v_report.status <> 'draft' or v_expense->>'method' = 'none'))
        or (v_amount is not null and (v_amount < 0 or v_amount > 100000 or trunc(v_amount) <> v_amount))
        or (v_expense->>'method' = 'none' and v_amount <> 0) then
        raise exception 'invalid_record_proposal' using errcode = '22023';
      end if;
      v_total := v_total + coalesce(v_amount,0);
      v_safe_expenses := v_safe_expenses || jsonb_build_array(jsonb_set(v_expense,'{staff_name}',to_jsonb(v_staff_name)));
    end loop;
    if (p_values->>'travel_cost_yen')::numeric <> v_total then
      raise exception 'invalid_record_proposal' using errcode = '22023';
    end if;
    p_values := jsonb_set(p_values,'{travel_expenses}',v_safe_expenses);
  end if;
  select f.schema into v_schema from public.form_templates f where f.client_id=v_report.client_id;
  if not found then v_schema := private.mcp_record_edit_default_schema(); end if;
  perform private.validate_mcp_record_edit_values(v_values,p_values,v_schema);
  if p_values = v_values and v_start is not distinct from v_report.start_at and v_end is not distinct from v_report.end_at
    and v_service is not distinct from v_report.actual_service_type_id and v_actual = v_before_actual then
    raise exception 'invalid_record_proposal' using errcode = '22023';
  end if;
  v_snapshot := private.mcp_record_edit_snapshot(p_org, p_report);
  v_after := jsonb_build_object('values',p_values,'start_at',v_start,'end_at',v_end,'actual_service_type_id',v_service,'actual_staffs',v_actual);
  v_refs := private.mcp_record_edit_references(p_org, p_report, v_after);
  perform pg_advisory_xact_lock(hashtextextended('mcp_record_edit:' || auth.uid()::text, 0));
  if (select count(*) from private.mcp_record_edit_proposals
      where actor_id = auth.uid() and created_at > clock_timestamp() - interval '1 hour') >= 50 then
    raise exception 'proposal_limit' using errcode = '54000';
  end if;
  if v_snapshot is null or v_refs is null or nullif(v_refs->'organization'->>'name','') is null
    or nullif(v_refs->'client'->>'name','') is null or not private.is_mcp_oauth_active() then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  insert into private.mcp_record_edit_proposals (
    organization_id, actor_id, oauth_client_id, oauth_session_id, report_id,
    expected_version, expected_revision_id, original_snapshot, reference_content, before_content, proposed_content, reason
  ) values (
    p_org, auth.uid(), (auth.jwt()->>'client_id')::uuid, (auth.jwt()->>'session_id')::uuid,
    p_report, p_expected_version, v_report.current_revision_id, v_snapshot, v_refs,
    jsonb_build_object('status', v_report.status, 'values', v_values,'start_at',v_report.start_at,'end_at',v_report.end_at,
      'actual_service_type_id',v_report.actual_service_type_id,'actual_staffs',v_before_actual),
    v_after, btrim(p_reason)
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function private.prepare_mcp_record_edit(uuid, uuid, bigint, jsonb, text, jsonb)
  from public, anon, authenticated, service_role, mcp_import;
