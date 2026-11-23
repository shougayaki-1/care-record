-- Recipient-controlled preferences. Nothing is enabled by default, and a row
-- neither grants data access nor authorizes any external delivery.
create table private.mcp_business_alert_subscriptions (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  enabled boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily','weekly')),
  pending_reports boolean not null default false,
  unassigned_shifts boolean not null default false,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (organization_id,user_id),
  check (not enabled or pending_reports or unassigned_shifts)
);
alter table private.mcp_business_alert_subscriptions enable row level security;
revoke all on private.mcp_business_alert_subscriptions from public,anon,authenticated,service_role,mcp_import;

-- An occurrence contains only identifiers and schedule periods, not report or
-- client contents. It supports atomic deduplication and safe job retries.
create table private.mcp_business_alert_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  event_type text not null check (event_type in ('business.pending_reports','business.unassigned_shifts')),
  period_start date not null,
  delivery_day date not null,
  frequency text not null check (frequency in ('daily','weekly')),
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id,user_id,event_type,period_start,frequency),
  unique (organization_id,user_id,event_type,delivery_day)
);
alter table private.mcp_business_alert_occurrences enable row level security;
revoke all on private.mcp_business_alert_occurrences from public,anon,authenticated,service_role,mcp_import;
