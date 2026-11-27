-- A disabled-by-default, separately controlled master edit flow. Proposals are
-- private staging data and never confer authority to update a master record.
create table private.mcp_master_edit_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_master_edit_controls enable row level security;
revoke all on private.mcp_master_edit_controls from public,anon,authenticated,service_role,mcp_import;

create table private.mcp_master_edit_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  oauth_client_id uuid not null,
  oauth_session_id uuid not null,
  kind text not null check (kind in ('client','staff')),
  target_id uuid not null,
  organization_name text not null,
  before_content jsonb not null check (jsonb_typeof(before_content)='object'),
  proposed_content jsonb not null check (jsonb_typeof(proposed_content)='object'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '10 minutes'),
  confirmed_at timestamptz,
  confirmed_session_id text,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check ((confirmed_at is null and confirmed_session_id is null) or (confirmed_at is not null and confirmed_session_id is not null))
);
alter table private.mcp_master_edit_proposals enable row level security;
revoke all on private.mcp_master_edit_proposals from public,anon,authenticated,service_role,mcp_import;
