-- A proposal is private state, not authorization to mutate a shift.
-- No public RPC or application role can create or read one until the confirmed
-- cancellation flow enforces the existing permissions and human confirmation.
create table private.mcp_shift_cancel_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_shift_cancel_controls enable row level security;
revoke all on table private.mcp_shift_cancel_controls from public, anon, authenticated, service_role, mcp_import;

create table private.mcp_shift_cancel_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  oauth_client_id uuid not null,
  oauth_session_id uuid not null,
  shift_id uuid not null references public.shifts(id),
  original_snapshot bytea not null check (octet_length(original_snapshot) = 32),
  before_content jsonb not null check (jsonb_typeof(before_content) = 'object'),
  operation text not null check (operation in ('cancel', 'soft_delete')),
  reason text not null check (char_length(reason) <= 500),
  reference_content jsonb not null check (jsonb_typeof(reference_content) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '10 minutes'),
  confirmed_at timestamptz,
  confirmed_session_id text,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check ((confirmed_at is null and confirmed_session_id is null) or
         (confirmed_at is not null and confirmed_session_id is not null))
);
alter table private.mcp_shift_cancel_proposals enable row level security;
revoke all on table private.mcp_shift_cancel_proposals from public, anon, authenticated, service_role, mcp_import;

-- Called only by a future authenticated confirmation transaction. Locking
-- consent/session/proof prevents revocation from racing past confirmation.
create function private.mcp_shift_cancel_oauth_valid(p_actor uuid, p_client uuid, p_session uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_granted timestamptz; v_verified timestamptz;
begin
  select granted_at into v_granted from auth.oauth_consents
    where user_id = p_actor and client_id = p_client and revoked_at is null for share;
  if v_granted is null then return false; end if;
  perform 1 from auth.sessions where id = p_session and user_id = p_actor and oauth_client_id = p_client
    and created_at <= clock_timestamp() and created_at + interval '30 days' > clock_timestamp()
    and (not_after is null or not_after > clock_timestamp()) for share;
  if not found then return false; end if;
  select verified_at into v_verified from private.mcp_reauth_proofs
    where user_id = p_actor and client_id = p_client and consent_granted_at = v_granted for share;
  return v_verified is not null and v_verified <= clock_timestamp()
    and v_verified + interval '30 days' > clock_timestamp()
    and exists (select 1 from auth.sessions where id = p_session and user_id = p_actor and oauth_client_id = p_client
      and created_at <= clock_timestamp() and created_at + interval '30 days' > clock_timestamp()
      and (not_after is null or not_after > clock_timestamp()));
end $$;
revoke all on function private.mcp_shift_cancel_oauth_valid(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, mcp_import;
