-- OAuth sessions have a strict 30-day lifetime from the Auth session creation time.
-- Recheck JWT expiry in the write RPC, including after lock waits.
create or replace function private.is_mcp_oauth_active()
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.role() <> 'mcp_import' then return false; end if;
  -- Supabase JWTs require a numeric exp. Reject missing, malformed or expired
  -- claims without relying on PostgREST's request-time clock-skew allowance.
  if jsonb_typeof(auth.jwt() -> 'exp') is distinct from 'number' then return false; end if;
  if (auth.jwt() ->> 'exp')::numeric <= extract(epoch from clock_timestamp()) then return false; end if;
  -- Match the Supabase Auth v2.193.1 revoke order: consent, then sessions.
  -- Share locks keep a concurrent revoke from completing until the RPC ends.
  perform 1 from auth.oauth_consents c
    where c.user_id = auth.uid() and c.client_id::text = auth.jwt() ->> 'client_id'
      and c.revoked_at is null for share;
  if not found then return false; end if;
  perform 1 from auth.sessions s
    where s.id::text = auth.jwt() ->> 'session_id'
      and s.user_id = auth.uid() and s.oauth_client_id::text = auth.jwt() ->> 'client_id'
      and s.created_at is not null and s.created_at <= clock_timestamp()
      and s.created_at + interval '30 days' > clock_timestamp()
      and (s.not_after is null or s.not_after > clock_timestamp()) for share;
  if not found then return false; end if;
  -- The lock can have waited past the deadline; check wall-clock time again.
  return (auth.jwt() ->> 'exp')::numeric > extract(epoch from clock_timestamp())
    and exists (select 1 from auth.sessions s
    where s.id::text = auth.jwt() ->> 'session_id' and s.user_id = auth.uid()
      and s.oauth_client_id::text = auth.jwt() ->> 'client_id'
      and s.created_at is not null and s.created_at <= clock_timestamp()
      and s.created_at + interval '30 days' > clock_timestamp()
      and (s.not_after is null or s.not_after > clock_timestamp()));
end;
$$;

-- POST-only reads use the same live OAuth and token checks as writes.
-- The retained signatures and grants are unchanged; PostgREST GET is read-only.
create or replace function public.list_mcp_workspaces()
returns table (id uuid, name text)
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if not private.is_mcp_oauth_active() then
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
returns text[] language plpgsql volatile security definer set search_path = '' as $$
declare
  v_names text[];
begin
  if not private.is_mcp_oauth_active()
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
