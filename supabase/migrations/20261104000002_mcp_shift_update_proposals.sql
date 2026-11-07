-- A proposal is private state, not authorization to mutate a shift.
-- No public RPC or application role can create or read one until the confirmed
-- update flow enforces the existing permissions and human confirmation.
create table private.mcp_shift_update_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_shift_update_controls enable row level security;
revoke all on table private.mcp_shift_update_controls from public, anon, authenticated, service_role, mcp_import;

create table private.mcp_shift_update_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  oauth_client_id uuid not null,
  oauth_session_id uuid not null,
  shift_id uuid not null references public.shifts(id),
  original_snapshot bytea not null check (octet_length(original_snapshot) = 32),
  before_content jsonb not null check (jsonb_typeof(before_content) = 'object'),
  proposed_content jsonb not null check (jsonb_typeof(proposed_content) = 'object'),
  reference_content jsonb not null check (jsonb_typeof(reference_content) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '10 minutes'),
  confirmed_at timestamptz,
  confirmed_session_id text,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check ((confirmed_at is null and confirmed_session_id is null) or
         (confirmed_at is not null and confirmed_session_id is not null))
);
alter table private.mcp_shift_update_proposals enable row level security;
revoke all on table private.mcp_shift_update_proposals from public, anon, authenticated, service_role, mcp_import;

-- Called only by a future authenticated confirmation transaction. Locking
-- consent/session/proof prevents revocation from racing past confirmation.
create function private.mcp_shift_update_oauth_valid(p_actor uuid, p_client uuid, p_session uuid)
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
revoke all on function private.mcp_shift_update_oauth_valid(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, mcp_import;

-- Minimal identities needed to render the full before/after comparison. This
-- snapshot deliberately excludes contact details, tokens and record contents.
create function private.mcp_shift_update_references(p_org uuid,p_shift uuid,p_segments jsonb)
returns jsonb language sql stable security invoker set search_path = '' set timezone = 'UTC' as $$
  with proposed_segments as (select value as segment from jsonb_array_elements(p_segments)),
  staff_ids as (
    select staff_id as id from public.shift_staffs where shift_id=p_shift
    union select x.staff_id from public.shift_segments t join public.shift_segment_staffs x on x.segment_id=t.id where t.shift_id=p_shift
    union select (x.value->>'staff_id')::uuid from proposed_segments t cross join lateral jsonb_array_elements(t.segment->'staffs') x
  ), role_ids as (
    select x.staff_role_id as id from public.shift_segments t join public.shift_segment_staffs x on x.segment_id=t.id where t.shift_id=p_shift and x.staff_role_id is not null
    union select nullif(x.value->>'staff_role_id','')::uuid from proposed_segments t cross join lateral jsonb_array_elements(t.segment->'staffs') x where nullif(x.value->>'staff_role_id','') is not null
  ), service_ids as (
    select service_type_id as id from public.shift_segments where shift_id=p_shift and service_type_id is not null
    union select nullif(segment->>'service_type_id','')::uuid from proposed_segments where nullif(segment->>'service_type_id','') is not null
  )
  select jsonb_build_object(
    'organization',jsonb_build_object('id',o.id,'name',o.name,'deleted_at',o.deleted_at),
    'client',jsonb_build_object('id',c.id,'name',c.name,'archived_at',c.archived_at,'deleted_at',c.deleted_at),
    'staffs',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',x.name,'archived_at',x.archived_at,'deleted_at',x.deleted_at) order by i.id)
      from staff_ids i left join public.staffs x on x.id=i.id and x.organization_id=p_org),'[]'::jsonb),
    'staff_roles',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',x.name,'is_active',x.is_active,'deleted_at',x.deleted_at) order by i.id)
      from role_ids i left join public.staff_roles x on x.id=i.id and x.organization_id=p_org),'[]'::jsonb),
    'service_types',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',x.name,'is_active',x.is_active,'deleted_at',x.deleted_at) order by i.id)
      from service_ids i left join public.service_types x on x.id=i.id and x.organization_id=p_org),'[]'::jsonb))
  from public.shifts s join public.organizations o on o.id=s.organization_id
    join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
  where s.id=p_shift and s.organization_id=p_org
$$;
revoke all on function private.mcp_shift_update_references(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role,mcp_import;

-- Complete shift-side values for the review screen; role IDs and source
-- pattern links must be visible so replacement of segments is not hidden.
-- Authorization is the responsibility of the private caller.
create function private.mcp_shift_update_before(p_org uuid,p_shift uuid)
returns jsonb language sql stable security invoker set search_path = '' set timezone = 'UTC' as $$
  select jsonb_build_object('id',s.id,'organization_id',s.organization_id,'client_id',s.client_id,
    'title',s.title,'start_at',s.start_at,'end_at',s.end_at,'status',s.status,
    'staffs',coalesce((select jsonb_agg(jsonb_build_object('staff_id',x.staff_id) order by x.staff_id)
      from public.shift_staffs x where x.shift_id=s.id),'[]'::jsonb),
    'segments',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'start_at',t.start_at,'end_at',t.end_at,
      'sort_order',t.sort_order,'service_type_id',t.service_type_id,'source_pattern_segment_id',t.source_pattern_segment_id,
      'staffs',coalesce((select jsonb_agg(jsonb_build_object('staff_id',x.staff_id,'staff_role_id',x.staff_role_id) order by x.id)
        from public.shift_segment_staffs x where x.segment_id=t.id),'[]'::jsonb)) order by t.sort_order,t.id)
      from public.shift_segments t where t.shift_id=s.id),'[]'::jsonb))
  from public.shifts s where s.id=p_shift and s.organization_id=p_org
$$;
revoke all on function private.mcp_shift_update_before(uuid,uuid)
  from public,anon,authenticated,service_role,mcp_import;

-- Do not disclose or use deleted/missing reference identities when preparing
-- or showing a proposal; the review must be understandable by the person.
create function private.mcp_shift_update_references_available(p_refs jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_typeof(p_refs)='object'
    and nullif(p_refs->'organization'->>'name','') is not null and p_refs->'organization'->>'deleted_at' is null
    and nullif(p_refs->'client'->>'name','') is not null and p_refs->'client'->>'deleted_at' is null
    and not exists(select 1 from jsonb_array_elements(p_refs->'staffs') x where nullif(x->>'name','') is null or x->>'deleted_at' is not null)
    and not exists(select 1 from jsonb_array_elements(p_refs->'staff_roles') x where nullif(x->>'name','') is null or x->>'deleted_at' is not null)
    and not exists(select 1 from jsonb_array_elements(p_refs->'service_types') x where nullif(x->>'name','') is null or x->>'deleted_at' is not null),false)
$$;
revoke all on function private.mcp_shift_update_references_available(jsonb) from public,anon,authenticated,service_role,mcp_import;
