-- AI submissions are review items. A sender may inspect their own submission,
-- while report reviewers may inspect submissions from their organization.
drop policy if exists "Read own AI import candidates" on public.ai_import_candidates;
create policy "Read submitted AI import candidates" on public.ai_import_candidates
  for select to authenticated using (
    (select private.is_session_active())
    and (auth.jwt() ->> 'client_id') is null
    and private.is_org_member(organization_id)
    and (
      created_by = (select auth.uid())
      or private.has_management_permission(organization_id, (select auth.uid()), 'reports')
    )
  );

-- Once submitted, only an authorized report reviewer can discard a candidate.
drop policy if exists "Delete own AI import candidates" on public.ai_import_candidates;
revoke delete on public.ai_import_candidates from authenticated;

create function public.discard_ai_import_candidate(p_organization_id uuid, p_candidate_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or (auth.jwt() ->> 'client_id') is not null
     or not private.is_session_active()
     or not private.has_management_permission(p_organization_id, auth.uid(), 'reports') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  delete from public.ai_import_candidates
    where id = p_candidate_id and organization_id = p_organization_id;
  if not found then raise exception 'candidate_not_found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.discard_ai_import_candidate(uuid, uuid) from public, anon, mcp_import;
grant execute on function public.discard_ai_import_candidate(uuid, uuid) to authenticated;

alter table public.ai_import_provenance
  add column submitted_by uuid references auth.users(id);

-- Lock the submission while converting it to a report. This prevents two
-- reviewers from creating two reports from the same candidate.
create function public.approve_ai_import_candidate(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_client_id uuid,
  p_staff_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_values jsonb,
  p_travel_method text,
  p_travel_cost_yen integer,
  p_session_id text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_candidate public.ai_import_candidates%rowtype;
  v_staff_name text;
  v_values jsonb;
  v_saved jsonb;
  v_report_id uuid;
begin
  if auth.uid() is null or (auth.jwt() ->> 'client_id') is not null
     or not private.is_session_active()
     or not private.has_management_permission(p_organization_id, auth.uid(), 'reports')
     or not private.can_record_action_for_client(p_organization_id, p_client_id, 'create')
     or not private.can_record_action_for_client(p_organization_id, p_client_id, 'approve') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at
     or p_values is null or jsonb_typeof(p_values) <> 'object'
     or octet_length(p_values::text) > 1000000
     or p_travel_method is null or p_travel_method not in ('car', 'public_transport', 'other', 'none')
     or p_travel_cost_yen is null or p_travel_cost_yen not between 0 and 100000
     or (p_travel_method = 'none' and p_travel_cost_yen <> 0) then
    raise exception 'invalid_ai_review' using errcode = '22023';
  end if;

  select * into v_candidate from public.ai_import_candidates
    where id = p_candidate_id and organization_id = p_organization_id for update;
  if not found then raise exception 'candidate_not_found' using errcode = 'P0002'; end if;
  select s.name into v_staff_name from public.staffs s
    where s.id = p_staff_id and s.organization_id = p_organization_id and s.deleted_at is null;
  if v_staff_name is null then raise exception 'staff_not_found' using errcode = 'P0002'; end if;

  v_values := (p_values - '_ai_import_source' - '_ai_import_candidate_id' - '_helpers'
    - 'travel_expenses' - 'travel_cost_yen') || jsonb_build_object(
      '_helpers', jsonb_build_array(v_staff_name),
      'travel_expenses', jsonb_build_array(jsonb_build_object(
        'staff_id', p_staff_id, 'staff_name', v_staff_name,
        'method', p_travel_method, 'amount_yen', p_travel_cost_yen
      )),
      'travel_cost_yen', p_travel_cost_yen
    );
  v_saved := public.save_report_versioned(
    p_organization_id, null, p_client_id, null, null, p_start_at, p_end_at,
    'pending', v_values, 0, p_candidate_id, p_session_id, null,
    jsonb_build_array(jsonb_build_object('staff_id', p_staff_id)), null
  );
  v_report_id := (v_saved ->> 'recordId')::uuid;
  insert into public.ai_import_provenance (
    report_id, candidate_id, organization_id, reviewed_by, submitted_by, source_file_name
  ) values (
    v_report_id, v_candidate.id, p_organization_id, auth.uid(),
    v_candidate.created_by, v_candidate.source_file_name
  );
  perform public.transition_reports_authorized(p_organization_id, array[v_report_id], 'approve');
  delete from public.ai_import_candidates where id = v_candidate.id;
  return v_report_id;
end;
$$;
revoke all on function public.approve_ai_import_candidate(uuid, uuid, uuid, uuid, timestamptz, timestamptz, jsonb, text, integer, text)
  from public, anon, mcp_import;
grant execute on function public.approve_ai_import_candidate(uuid, uuid, uuid, uuid, timestamptz, timestamptz, jsonb, text, integer, text)
  to authenticated;

-- The connected user may use their own staff name as an OCR hint. This does
-- not expose the organization-wide staff directory or client-specific forms.
create function public.get_mcp_self_staff_names(p_organization_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_names text[];
begin
  if auth.uid() is null or auth.role() <> 'mcp_import'
     or nullif(auth.jwt() ->> 'client_id', '') is null
     or not private.is_org_member(p_organization_id) then
    raise exception 'mcp_oauth_required' using errcode = '42501';
  end if;
  select coalesce(array_agg(s.name order by s.name), array[]::text[])
    into v_names from public.staffs s
   where s.organization_id = p_organization_id and s.user_id = auth.uid()
     and s.archived_at is null and s.deleted_at is null;
  return v_names;
end;
$$;
revoke all on function public.get_mcp_self_staff_names(uuid) from public, anon, authenticated;
grant execute on function public.get_mcp_self_staff_names(uuid) to mcp_import;
