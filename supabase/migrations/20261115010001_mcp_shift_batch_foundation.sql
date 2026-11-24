-- Batch membership is private; the existing single-shift proposal remains the
-- source of the immutable before/after snapshot and authorization checks.
create table private.mcp_shift_update_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  oauth_client_id uuid not null,
  oauth_session_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '10 minutes'),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
alter table private.mcp_shift_update_batches enable row level security;
revoke all on private.mcp_shift_update_batches from public, anon, authenticated, service_role, mcp_import;

create table private.mcp_shift_update_batch_items (
  batch_id uuid not null references private.mcp_shift_update_batches(id),
  position integer not null check (position between 1 and 10),
  proposal_id uuid not null unique references private.mcp_shift_update_proposals(id),
  has_overlap boolean not null,
  has_unassigned boolean not null,
  primary key (batch_id, position)
);
alter table private.mcp_shift_update_batch_items enable row level security;
revoke all on private.mcp_shift_update_batch_items from public, anon, authenticated, service_role, mcp_import;

-- Internal only: a later MCP RPC may expose this after review and confirmation
-- are in place. Any bad input or authorization failure rolls back the batch.
create function private.prepare_mcp_shift_update_batch(p_organization_id uuid, p_items jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_batch uuid; v_proposal uuid; v_item jsonb; v_shift uuid; v_start timestamptz; v_end timestamptz;
  v_seen uuid[] := array[]::uuid[]; v_position integer := 0; v_segment jsonb; v_staff jsonb; v_check jsonb;
  v_overlap boolean; v_unassigned boolean; v_checks integer := 0;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 10 then
    raise exception 'invalid_shift_proposal' using errcode='22023';
  end if;
  perform private.assert_mcp_shift_read(p_organization_id);
  insert into private.mcp_shift_update_batches(organization_id, actor_id, oauth_client_id, oauth_session_id)
    values (p_organization_id, auth.uid(), (auth.jwt()->>'client_id')::uuid, (auth.jwt()->>'session_id')::uuid)
    returning id into v_batch;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('shift_id','start_at','end_at','segments'))
      or jsonb_typeof(v_item->'shift_id') is distinct from 'string'
      or jsonb_typeof(v_item->'start_at') is distinct from 'string'
      or jsonb_typeof(v_item->'end_at') is distinct from 'string'
      or (v_item->>'start_at') !~ '[Tt].*([Zz]|[+-][0-9]{2}:[0-9]{2})$'
      or (v_item->>'end_at') !~ '[Tt].*([Zz]|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'invalid_shift_proposal' using errcode='22023';
    end if;
    begin
      v_shift := (v_item->>'shift_id')::uuid;
      v_start := (v_item->>'start_at')::timestamptz;
      v_end := (v_item->>'end_at')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid_shift_proposal' using errcode='22023';
    end;
    if v_shift = any(v_seen) then raise exception 'invalid_shift_proposal' using errcode='22023'; end if;
    v_seen := array_append(v_seen, v_shift);
    v_proposal := private.prepare_mcp_shift_update(p_organization_id, v_shift, v_start, v_end, v_item->'segments');
    v_overlap := false; v_unassigned := false;
    for v_segment in select value from jsonb_array_elements(v_item->'segments') loop
      for v_staff in select value from jsonb_array_elements(v_segment->'staffs') loop
        v_checks := v_checks + 1;
        if v_checks > 100 then raise exception 'invalid_shift_proposal' using errcode='22023'; end if;
        v_check := public.propose_mcp_shift_change(p_organization_id,v_shift,(v_staff->>'staff_id')::uuid,
          (v_segment->>'start_at')::timestamptz,(v_segment->>'end_at')::timestamptz);
        if v_check is null then raise exception 'proposal_unavailable' using errcode='42501'; end if;
        v_overlap := v_overlap or coalesce((v_check->>'overlap')::boolean,false);
        v_unassigned := v_unassigned or coalesce(v_check->>'assigned_to_client' = 'false',false);
      end loop;
    end loop;
    v_position := v_position + 1;
    insert into private.mcp_shift_update_batch_items(batch_id, position, proposal_id, has_overlap, has_unassigned)
      values(v_batch, v_position, v_proposal, v_overlap, v_unassigned);
  end loop;
  return v_batch;
end $$;
revoke all on function private.prepare_mcp_shift_update_batch(uuid,jsonb) from public, anon, authenticated, service_role, mcp_import;
