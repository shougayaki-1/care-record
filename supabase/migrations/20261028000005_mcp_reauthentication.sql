-- #168: human verification is enforced by the database, even if the Auth
-- consent API auto-approves an already granted client. Identity proofs are
-- account/client scoped (not organization data), never contain credentials,
-- and are accessible only through the authorized security-definer functions.
alter table public.reauth_grants drop constraint reauth_grants_purpose_check;
alter table public.reauth_grants add constraint reauth_grants_purpose_check check (purpose in (
  'owner_transfer', 'owner_add', 'organization_delete', 'external_secret_change', 'backup_restore',
  'account_password_change', 'account_email_change', 'account_delete', 'account_password_reset', 'mcp_connection'
));
alter table public.stepup_reauth_challenges drop constraint stepup_reauth_challenges_purpose_check;
alter table public.stepup_reauth_challenges add constraint stepup_reauth_challenges_purpose_check check (purpose in (
  'owner_transfer', 'owner_add', 'organization_delete', 'external_secret_change', 'backup_restore',
  'account_password_change', 'account_email_change', 'account_delete', 'mcp_connection'
));

create table private.mcp_pending_reauth (
  authorization_id text primary key,
  user_id uuid not null references auth.users(id),
  client_id uuid not null references auth.oauth_clients(id),
  browser_session_id text not null,
  verified_at timestamptz not null,
  finalized_at timestamptz null
);
create table private.mcp_reauth_proofs (
  user_id uuid not null references auth.users(id),
  client_id uuid not null references auth.oauth_clients(id),
  consent_granted_at timestamptz not null,
  verified_at timestamptz not null,
  primary key (user_id, client_id)
);
alter table private.mcp_pending_reauth enable row level security;
alter table private.mcp_reauth_proofs enable row level security;
revoke all on private.mcp_pending_reauth, private.mcp_reauth_proofs from public, anon, authenticated, mcp_import, service_role;

-- Caller must have a live application session, not an MCP session. The one-use
-- step-up token is bound to that same browser session and purpose.
create function private.mcp_browser_session_active() returns boolean
language sql volatile security definer set search_path = '' as $$
  select auth.role() = 'authenticated' and auth.uid() is not null and exists (
    select 1 from public.user_session_activity a
    where a.user_id = auth.uid() and a.auth_session_id = auth.jwt()->>'session_id'
      and a.revoked_at is null and a.last_activity >= clock_timestamp() - interval '24 hours'
      and a.absolute_expires_at > clock_timestamp() for share
  );
$$;
revoke all on function private.mcp_browser_session_active() from public, anon, authenticated, mcp_import, service_role;

create function public.prepare_mcp_reauth(p_authorization_id text, p_token_hash text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_client uuid;
begin
  if not private.mcp_browser_session_active() then raise exception 'reauth_required' using errcode = '42501'; end if;
  select a.client_id into v_client from auth.oauth_authorizations a
    where a.authorization_id = p_authorization_id and a.status = 'pending'
      and a.expires_at > clock_timestamp() and (a.user_id is null or a.user_id = auth.uid());
  if v_client is null then raise exception 'reauth_required' using errcode = '42501'; end if;
  update public.reauth_grants g set used_at = clock_timestamp()
    where g.token_hash = p_token_hash and g.user_id = auth.uid()
      and g.auth_session_id = auth.jwt()->>'session_id' and g.purpose = 'mcp_connection'
      and g.used_at is null and g.expires_at > clock_timestamp();
  if not found then raise exception 'reauth_required' using errcode = '42501'; end if;
  insert into private.mcp_pending_reauth values
    (p_authorization_id, auth.uid(), v_client, auth.jwt()->>'session_id', clock_timestamp(), null)
    on conflict (authorization_id) do update set user_id = excluded.user_id, client_id = excluded.client_id,
      browser_session_id = excluded.browser_session_id, verified_at = excluded.verified_at
    where mcp_pending_reauth.finalized_at is null;
  if not found then raise exception 'reauth_required' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.prepare_mcp_reauth(text,text) from public, anon, mcp_import, service_role;
grant execute on function public.prepare_mcp_reauth(text,text) to authenticated;

create function public.mcp_reauth_prepared(p_authorization_id text) returns boolean
language sql volatile security definer set search_path = '' as $$
  select private.mcp_browser_session_active() and exists (
    select 1 from private.mcp_pending_reauth p join auth.oauth_authorizations a using (authorization_id)
    where p.authorization_id = p_authorization_id and p.user_id = auth.uid()
      and p.browser_session_id = auth.jwt()->>'session_id' and p.finalized_at is null
      and p.verified_at > clock_timestamp() - interval '10 minutes'
      and a.status = 'pending' and a.expires_at > clock_timestamp()
      and (a.user_id is null or a.user_id = auth.uid()) and a.client_id = p.client_id
  );
$$;
revoke all on function public.mcp_reauth_prepared(text) from public, anon, mcp_import, service_role;
grant execute on function public.mcp_reauth_prepared(text) to authenticated;

-- Called only after Supabase has approved the same authorization. Binding to
-- granted_at prevents a revoked-and-regranted consent reusing an old proof.
create function public.finalize_mcp_reauth(p_authorization_id text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_client uuid; v_verified timestamptz; v_granted timestamptz;
begin
  if not private.mcp_browser_session_active() then raise exception 'reauth_required' using errcode = '42501'; end if;
  select p.client_id, p.verified_at into v_client, v_verified
  from private.mcp_pending_reauth p join auth.oauth_authorizations a using (authorization_id)
  where p.authorization_id = p_authorization_id and p.user_id = auth.uid()
    and p.browser_session_id = auth.jwt()->>'session_id' and p.finalized_at is null
    and p.verified_at > clock_timestamp() - interval '10 minutes'
    and a.user_id = auth.uid() and a.client_id = p.client_id and a.status = 'approved'
    and a.approved_at >= p.verified_at and a.expires_at > clock_timestamp();
  if v_client is null then raise exception 'reauth_required' using errcode = '42501'; end if;
  select c.granted_at into v_granted from auth.oauth_consents c
    where c.user_id = auth.uid() and c.client_id = v_client and c.revoked_at is null for share;
  if v_granted is null then raise exception 'reauth_required' using errcode = '42501'; end if;
  -- Consume exactly once under the consent lock. The Auth API writes the
  -- consent after approved_at on first approval, so their timestamps must not
  -- be compared as though consent were always older than authorization.
  update private.mcp_pending_reauth set finalized_at = clock_timestamp()
    where authorization_id = p_authorization_id and finalized_at is null
      and user_id = auth.uid() and browser_session_id = auth.jwt()->>'session_id'
      and verified_at = v_verified and verified_at > clock_timestamp() - interval '10 minutes'
      and exists (select 1 from auth.oauth_authorizations a where a.authorization_id=p_authorization_id
        and a.status='approved' and a.user_id=auth.uid() and a.client_id=v_client
        and a.expires_at > clock_timestamp());
  if not found then raise exception 'reauth_required' using errcode = '42501'; end if;
  insert into private.mcp_reauth_proofs values (auth.uid(), v_client, v_granted, v_verified)
    on conflict (user_id, client_id) do update set consent_granted_at = excluded.consent_granted_at,
      verified_at = excluded.verified_at;
  insert into public.audit_events(organization_id,actor_id,session_id,action_type,resource_type,resource_id,outcome,details)
    values(null,auth.uid(),auth.jwt()->>'session_id','mcp.connection_reauthenticated','oauth_client',v_client::text,'success','{}');
end;
$$;
revoke all on function public.finalize_mcp_reauth(text) from public, anon, mcp_import, service_role;
grant execute on function public.finalize_mcp_reauth(text) to authenticated;

create or replace function private.is_mcp_oauth_active() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_granted timestamptz; v_verified timestamptz;
begin
  if auth.uid() is null or auth.role() <> 'mcp_import' then return false; end if;
  if jsonb_typeof(auth.jwt()->'exp') is distinct from 'number' then return false; end if;
  if (auth.jwt()->>'exp')::numeric <= extract(epoch from clock_timestamp()) then return false; end if;
  select c.granted_at into v_granted from auth.oauth_consents c
    where c.user_id = auth.uid() and c.client_id::text = auth.jwt()->>'client_id'
      and c.revoked_at is null for share;
  if v_granted is null then return false; end if;
  perform 1 from auth.sessions s where s.id::text = auth.jwt()->>'session_id'
    and s.user_id = auth.uid() and s.oauth_client_id::text = auth.jwt()->>'client_id'
    and s.created_at is not null and s.created_at <= clock_timestamp()
    and s.created_at + interval '30 days' > clock_timestamp()
    and (s.not_after is null or s.not_after > clock_timestamp()) for share;
  if not found then return false; end if;
  select p.verified_at into v_verified from private.mcp_reauth_proofs p
    where p.user_id = auth.uid() and p.client_id::text = auth.jwt()->>'client_id'
      and p.consent_granted_at = v_granted for share;
  if v_verified is null or v_verified > clock_timestamp()
     or v_verified + interval '30 days' <= clock_timestamp() then return false; end if;
  return (auth.jwt()->>'exp')::numeric > extract(epoch from clock_timestamp()) and exists (
    select 1 from auth.sessions s where s.id::text = auth.jwt()->>'session_id' and s.user_id = auth.uid()
      and s.oauth_client_id::text = auth.jwt()->>'client_id' and s.created_at <= clock_timestamp()
      and s.created_at + interval '30 days' > clock_timestamp()
      and (s.not_after is null or s.not_after > clock_timestamp()));
end;
$$;
