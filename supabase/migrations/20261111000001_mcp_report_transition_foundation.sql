-- Private, disabled-by-default staging for human-confirmed report transitions.
-- No public proposal or confirmation RPC is granted by this foundation.
create table private.mcp_report_transition_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_report_transition_controls enable row level security;
revoke all on table private.mcp_report_transition_controls from public, anon, authenticated, service_role, mcp_import;

create table private.mcp_report_transition_proposals (
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
  transition text not null check (transition in ('approve', 'remand')),
  reason text,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '10 minutes'),
  confirmed_at timestamptz,
  confirmed_session_id text,
  status_epoch uuid,
  result jsonb,
  check ((transition = 'approve' and reason is null) or
         (transition = 'remand' and reason is not null and char_length(btrim(reason)) between 1 and 500)),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check ((confirmed_at is null and confirmed_session_id is null and status_epoch is null and result is null) or
         (confirmed_at is not null and confirmed_session_id is not null and status_epoch is not null and result is not null))
);
create index mcp_report_transition_actor_created_idx on private.mcp_report_transition_proposals(actor_id,created_at);
create index mcp_report_transition_report_epoch_idx on private.mcp_report_transition_proposals(report_id,status_epoch);
alter table private.mcp_report_transition_proposals enable row level security;
revoke all on table private.mcp_report_transition_proposals from public, anon, authenticated, service_role, mcp_import;

-- A status epoch distinguishes successive remands even when existing status
-- transitions do not advance reports.current_version. Ordinary content edits
-- leave the epoch unchanged, so the current reason remains visible.
create table private.mcp_report_status_epochs (
  report_id uuid primary key references public.reports(id),
  epoch uuid not null
);
alter table private.mcp_report_status_epochs enable row level security;
revoke all on table private.mcp_report_status_epochs from public, anon, authenticated, service_role, mcp_import;
create function private.update_mcp_report_status_epoch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into private.mcp_report_status_epochs(report_id,epoch) values(new.id,gen_random_uuid())
      on conflict (report_id) do update set epoch=excluded.epoch;
  end if;
  return new;
end $$;
revoke all on function private.update_mcp_report_status_epoch() from public,anon,authenticated,service_role,mcp_import;
create trigger mcp_report_status_epoch after update of status on public.reports
  for each row execute function private.update_mcp_report_status_epoch();
