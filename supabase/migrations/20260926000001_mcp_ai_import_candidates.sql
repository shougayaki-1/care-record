-- An MCP client may submit unverified readings, never completed reports.
create table public.ai_import_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_file_name text not null default '',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint ai_import_candidates_source_name_length check (length(source_file_name) <= 255),
  constraint ai_import_candidates_payload_shape check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 100000
  )
);

create index ai_import_candidates_inbox_idx
  on public.ai_import_candidates (created_by, organization_id, created_at desc);

alter table public.ai_import_candidates enable row level security;

create policy "Read own AI import candidates"
  on public.ai_import_candidates for select to authenticated
  using (created_by = (select auth.uid()) and private.is_org_member(organization_id));

create policy "Submit own AI import candidates"
  on public.ai_import_candidates for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.is_org_member(organization_id)
  );

create policy "Delete own AI import candidates"
  on public.ai_import_candidates for delete to authenticated
  using (created_by = (select auth.uid()) and private.is_org_member(organization_id));

revoke all on public.ai_import_candidates from anon, authenticated;
grant select, insert, delete on public.ai_import_candidates to authenticated;

-- OAuth sessions do not use the app's browser-session activity table. Return
-- only workspace names needed to select a destination for an import candidate.
create function public.list_mcp_workspaces()
returns table (id uuid, name text)
language sql stable security definer
set search_path = ''
as $$
  select o.id, o.name
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = auth.uid()
  order by o.name;
$$;

revoke all on function public.list_mcp_workspaces() from public, anon;
grant execute on function public.list_mcp_workspaces() to authenticated;
