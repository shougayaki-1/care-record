-- Every OAuth client receives a database role that has no application grants.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_import') then
    create role mcp_import nologin noinherit;
  end if;
end $$;
grant mcp_import to authenticator;
grant usage on schema public to mcp_import;

create or replace function public.mcp_access_token_hook(event jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  claims jsonb := event -> 'claims';
begin
  if nullif(coalesce(event ->> 'client_id', claims ->> 'client_id'), '') is not null then
    claims := jsonb_set(claims, '{role}', '"mcp_import"'::jsonb);
    return jsonb_set(event, '{claims}', claims);
  end if;
  return event;
end;
$$;
revoke all on function public.mcp_access_token_hook(jsonb) from public, anon, authenticated, mcp_import;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.mcp_access_token_hook(jsonb) to supabase_auth_admin;

-- Browser sessions can review or discard their own candidates, but cannot forge submissions.
drop policy if exists "Submit own AI import candidates" on public.ai_import_candidates;
revoke insert on public.ai_import_candidates from authenticated;
drop policy if exists "Read own AI import candidates" on public.ai_import_candidates;
create policy "Read own AI import candidates" on public.ai_import_candidates
  for select to authenticated using (
    created_by = (select auth.uid())
    and (select private.is_session_active())
    and private.is_org_member(organization_id)
    and (auth.jwt() ->> 'client_id') is null
  );
drop policy if exists "Delete own AI import candidates" on public.ai_import_candidates;
create policy "Delete own AI import candidates" on public.ai_import_candidates
  for delete to authenticated using (
    created_by = (select auth.uid())
    and (select private.is_session_active())
    and private.is_org_member(organization_id)
    and (auth.jwt() ->> 'client_id') is null
  );

revoke all on function public.list_mcp_workspaces() from public, anon, authenticated;
grant execute on function public.list_mcp_workspaces() to mcp_import;

create function public.submit_mcp_candidate(
  p_organization_id uuid, p_source_file_name text, p_payload jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or auth.role() <> 'mcp_import'
     or nullif(auth.jwt() ->> 'client_id', '') is null then
    raise exception 'mcp_oauth_required' using errcode = '42501';
  end if;
  if not private.is_org_member(p_organization_id) then
    raise exception 'organization_access_denied' using errcode = '42501';
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
  insert into public.ai_import_candidates (organization_id, created_by, source_file_name, payload)
  values (p_organization_id, auth.uid(), p_source_file_name, p_payload)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_mcp_candidate(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_mcp_candidate(uuid, text, jsonb) to mcp_import;

-- Only the application server records provenance after its normal report save succeeds.
create table public.ai_import_provenance (
  report_id uuid primary key references public.reports(id) on delete cascade,
  candidate_id uuid not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reviewed_by uuid not null references auth.users(id),
  source text not null default 'mcp' check (source = 'mcp'),
  source_file_name text not null default '',
  reviewed_at timestamptz not null default now()
);
create index ai_import_provenance_org_idx on public.ai_import_provenance (organization_id, reviewed_at desc);
alter table public.ai_import_provenance enable row level security;
create policy "Read AI provenance for visible reports" on public.ai_import_provenance
  for select to authenticated using (
    (select private.is_session_active())
    and (auth.jwt() ->> 'client_id') is null
    and exists (select 1 from public.reports r join public.clients c on c.id = r.client_id
      where r.id = report_id and c.organization_id = organization_id and r.deleted_at is null)
  );
revoke all on public.ai_import_provenance from public, anon, authenticated, mcp_import;
grant select on public.ai_import_provenance to authenticated;
