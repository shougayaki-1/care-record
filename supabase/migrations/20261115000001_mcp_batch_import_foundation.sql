-- Retry identifiers and digests are private. No PDF, extracted text or file
-- name is copied into this table. Candidate rows retain the existing lifecycle.
create table private.mcp_batch_import_items (
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  request_id uuid not null,
  request_hash bytea not null check (octet_length(request_hash)=32),
  payload_hash bytea not null check (octet_length(payload_hash)=32),
  candidate_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id,actor_id,request_id)
);
create index mcp_batch_import_digest_idx on private.mcp_batch_import_items(organization_id,actor_id,payload_hash);
alter table private.mcp_batch_import_items enable row level security;
revoke all on private.mcp_batch_import_items from public,anon,authenticated,service_role,mcp_import;

-- This helper remains unexposed until batch normalization, clarification and
-- the MCP tool are available. All candidates use the existing authorized RPC.
create function private.submit_mcp_batch_item(p_org uuid,p_request uuid,p_name text,p_payload jsonb,p_allow_duplicate boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_existing private.mcp_batch_import_items%rowtype; v_candidate uuid; v_payload_hash bytea; v_request_hash bytea;
begin
  if not private.is_mcp_oauth_active() then raise exception 'mcp_oauth_required' using errcode='42501'; end if;
  if p_org is null or p_request is null or p_name is null or length(p_name)>255 or p_allow_duplicate is null
    or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>100000
    or jsonb_typeof(p_payload->'meta') is distinct from 'object' or jsonb_typeof(p_payload->'values') is distinct from 'object'
    or jsonb_typeof(p_payload->'warnings') is distinct from 'array' or coalesce(p_payload->>'confidence','') not in ('high','medium','low')
    or (select count(*) from pg_catalog.jsonb_object_keys(p_payload->'values'))>100 or jsonb_array_length(p_payload->'warnings')>50 then
    raise exception 'invalid_candidate_payload' using errcode='22023';
  end if;
  perform 1 from public.organizations where id=p_org and deleted_at is null for share;
  if not found then raise exception 'mcp_import_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
  if not found then raise exception 'mcp_import_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles in share mode;
  if not private.is_org_member(p_org) or not exists(select 1 from private.mcp_import_controls where organization_id=p_org and enabled)
    or private.get_member_record_action_scope(p_org,auth.uid(),'create') is distinct from 'all' then
    raise exception 'mcp_import_unavailable' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mcp_candidate:' || auth.uid()::text,0));
  if not private.is_mcp_oauth_active() or not private.is_org_member(p_org)
    or private.get_member_record_action_scope(p_org,auth.uid(),'create') is distinct from 'all' then
    raise exception 'mcp_import_unavailable' using errcode='42501';
  end if;
  v_payload_hash := extensions.digest(convert_to(jsonb_build_array(p_payload->'meta',p_payload->'values')::text,'UTF8'),'sha256');
  v_request_hash := extensions.digest(convert_to(jsonb_build_array(p_name,p_payload)::text,'UTF8'),'sha256');
  select * into v_existing from private.mcp_batch_import_items where organization_id=p_org and actor_id=auth.uid() and request_id=p_request;
  if found then
    if v_existing.request_hash is distinct from v_request_hash then raise exception 'request_conflict' using errcode='22023'; end if;
    return jsonb_build_object('status',case when exists(select 1 from public.ai_import_candidates where id=v_existing.candidate_id and organization_id=p_org and created_by=auth.uid()) then 'submitted' else 'already_processed' end,
      'candidate_id',v_existing.candidate_id,'replayed',true);
  end if;
  if not p_allow_duplicate and (
    exists(select 1 from private.mcp_batch_import_items where organization_id=p_org and actor_id=auth.uid() and payload_hash=v_payload_hash)
    or exists(select 1 from public.ai_import_candidates where organization_id=p_org and created_by=auth.uid() and payload->'meta'=p_payload->'meta' and payload->'values'=p_payload->'values')
  ) then return jsonb_build_object('status','possible_duplicate'); end if;
  v_candidate := public.submit_mcp_candidate(p_org,p_name,p_payload);
  insert into private.mcp_batch_import_items(organization_id,actor_id,request_id,request_hash,payload_hash,candidate_id)
    values(p_org,auth.uid(),p_request,v_request_hash,v_payload_hash,v_candidate);
  return jsonb_build_object('status','submitted','candidate_id',v_candidate,'replayed',false);
end $$;
revoke all on function private.submit_mcp_batch_item(uuid,uuid,text,jsonb,boolean) from public,anon,authenticated,service_role,mcp_import;
