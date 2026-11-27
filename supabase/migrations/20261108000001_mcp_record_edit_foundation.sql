-- Private staging only: neither a proposal nor an enabled control grants a
-- caller permission to change an existing record. The review and confirmation
-- RPCs must recheck the session, consent, organization, permissions and version.
create table private.mcp_record_edit_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_record_edit_controls enable row level security;
revoke all on table private.mcp_record_edit_controls from public, anon, authenticated, service_role, mcp_import;

create table private.mcp_record_edit_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  oauth_client_id uuid not null,
  oauth_session_id uuid not null,
  report_id uuid not null references public.reports(id),
  expected_version bigint not null check (expected_version >= 0),
  expected_revision_id uuid references public.record_versions(id),
  original_snapshot bytea not null check (octet_length(original_snapshot) = 32),
  reference_content jsonb not null check (jsonb_typeof(reference_content) = 'object'),
  before_content jsonb not null check (jsonb_typeof(before_content) = 'object'),
  proposed_content jsonb not null check (jsonb_typeof(proposed_content) = 'object'),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '10 minutes'),
  confirmed_at timestamptz,
  confirmed_session_id text,
  result jsonb,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check ((confirmed_at is null and confirmed_session_id is null and result is null) or
         (confirmed_at is not null and confirmed_session_id is not null and result is not null))
);
alter table private.mcp_record_edit_proposals enable row level security;
revoke all on table private.mcp_record_edit_proposals from public, anon, authenticated, service_role, mcp_import;
