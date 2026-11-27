-- OAuth JWTs remain cryptographically valid after a grant is revoked. Check
-- the corresponding live Auth session and consent on every MCP RPC instead.
-- Claims are compared as text to reject malformed UUIDs without cast errors.
create function private.is_mcp_oauth_active()
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.role() <> 'mcp_import' then return false; end if;
  -- Match the Supabase Auth v2.193.1 revoke order: consent, then sessions.
  -- Share locks keep a concurrent revoke from completing until the RPC ends.
  perform 1 from auth.oauth_consents c
    where c.user_id = auth.uid() and c.client_id::text = auth.jwt() ->> 'client_id'
      and c.revoked_at is null for share;
  if not found then return false; end if;
  perform 1 from auth.sessions s
    where s.id::text = auth.jwt() ->> 'session_id'
      and s.user_id = auth.uid() and s.oauth_client_id::text = auth.jwt() ->> 'client_id'
      and (s.not_after is null or s.not_after > clock_timestamp()) for share;
  if not found then return false; end if;
  -- The lock can have waited past the deadline; check wall-clock time again.
  return exists (select 1 from auth.sessions s
    where s.id::text = auth.jwt() ->> 'session_id' and s.user_id = auth.uid()
      and s.oauth_client_id::text = auth.jwt() ->> 'client_id'
      and (s.not_after is null or s.not_after > clock_timestamp()));
end;
$$;
revoke all on function private.is_mcp_oauth_active() from public, anon, authenticated, mcp_import, service_role;

-- Read RPCs use one statement snapshot to preserve PostgREST GET support.
-- A read already in progress may finish after a concurrent revoke commits.
create function private.is_mcp_oauth_active_for_read()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.uid() is not null and auth.role() = 'mcp_import'
    and exists (
      select 1 from auth.sessions s
      join auth.oauth_consents c on c.user_id = s.user_id and c.client_id = s.oauth_client_id
      where s.id::text = auth.jwt() ->> 'session_id'
        and s.user_id = auth.uid()
        and s.oauth_client_id::text = auth.jwt() ->> 'client_id'
        and (s.not_after is null or s.not_after > now())
        and c.revoked_at is null
    ), false);
$$;
revoke all on function private.is_mcp_oauth_active_for_read() from public, anon, authenticated, mcp_import, service_role;

create or replace function public.list_mcp_workspaces()
returns table (id uuid, name text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_mcp_oauth_active_for_read() then
    raise exception 'mcp_oauth_required' using errcode = '42501';
  end if;
  return query select o.id, o.name
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = auth.uid()
  order by o.name;
end;
$$;


create or replace function public.get_mcp_self_staff_names(p_organization_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_names text[];
begin
  if not private.is_mcp_oauth_active_for_read()
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
