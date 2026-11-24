-- Legacy candidate submissions have no authenticated client ID.
-- Keep assigned and none fail closed until a scoped submission flow is available.
create or replace function public.submit_mcp_candidate(
  p_organization_id uuid, p_source_file_name text, p_payload jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.is_mcp_oauth_active() then
    raise exception 'mcp_oauth_required' using errcode = '42501';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception 'organization_access_denied' using errcode = '42501';
  end if;
  -- Serialize with changes to the organization switch, including its absent-row state.
  perform 1 from public.organizations where id = p_organization_id and deleted_at is null for share;
  if not found then
    raise exception 'mcp_import_unavailable' using errcode = '42501';
  end if;
  -- Organization first, then membership, matching organization removal order.
  perform 1 from public.organization_members
    where organization_id = p_organization_id and user_id = auth.uid() for share;
  if not found or not private.is_org_member(p_organization_id) or not exists (
    select 1 from private.mcp_import_controls where organization_id = p_organization_id and enabled
  ) then
    raise exception 'mcp_import_unavailable' using errcode = '42501';
  end if;
  -- Legacy submissions have no trusted client ID; assigned scope cannot be verified.
  if private.get_member_record_action_scope(p_organization_id, auth.uid(), 'create') is distinct from 'all' then
    raise exception 'mcp_import_unavailable' using errcode = '42501';
  end if;
  if p_source_file_name is null or length(p_source_file_name) > 255
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 100000
     or jsonb_typeof(p_payload -> 'meta') <> 'object'
     or jsonb_typeof(p_payload -> 'values') <> 'object'
     or jsonb_typeof(p_payload -> 'warnings') <> 'array'
     or coalesce(p_payload ->> 'confidence', '') not in ('high', 'medium', 'low')
     or (select count(*) from pg_catalog.jsonb_object_keys(p_payload -> 'values')) > 100
     or jsonb_array_length(p_payload -> 'warnings') > 50 then
    raise exception 'invalid_candidate_payload' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp_candidate:' || auth.uid()::text, 0));
  if (select count(*) from public.ai_import_candidates
      where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 50
     or (select count(*) from public.ai_import_candidates where created_by = auth.uid()) >= 100 then
    raise exception 'candidate_limit_reached' using errcode = '54000';
  end if;
  -- Other locks may also have waited past the session deadline.
  if not private.is_mcp_oauth_active() then
    raise exception 'mcp_oauth_required' using errcode = '42501';
  end if;
  insert into public.ai_import_candidates (organization_id, created_by, source_file_name, payload)
  values (p_organization_id, auth.uid(), p_source_file_name, p_payload)
  returning id into v_id;
  return v_id;
end;
$$;
