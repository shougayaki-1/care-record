-- A batch is a fixed set of existing single-record proposals. Confirmation
-- invokes all of them in one transaction; any error rolls back every change.
create table private.mcp_report_transition_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  oauth_client_id uuid not null,
  oauth_session_id uuid not null,
  proposal_ids uuid[] not null check (cardinality(proposal_ids) between 1 and 20),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
alter table private.mcp_report_transition_batches enable row level security;
revoke all on private.mcp_report_transition_batches from public,anon,authenticated,service_role,mcp_import;

create function public.prepare_mcp_report_transition_batch(p_org uuid,p_records jsonb,p_transition text,p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_item jsonb; v_ids uuid[] := '{}'; v_report uuid; v_version bigint; v_id uuid; v_batch uuid; v_expiry timestamptz;
begin
  perform private.assert_mcp_record_read(p_org);
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 20 then
    raise exception 'invalid_report_transition' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(v_item) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_item)) <> 2
      or jsonb_typeof(v_item->'record_id') is distinct from 'string'
      or jsonb_typeof(v_item->'expected_version') is distinct from 'number'
      or v_item->>'expected_version' !~ '^(0|[1-9][0-9]{0,15})$' then
      raise exception 'invalid_report_transition' using errcode='22023';
    end if;
    begin
      v_report := (v_item->>'record_id')::uuid;
      v_version := (v_item->>'expected_version')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid_report_transition' using errcode='22023';
    end;
    if exists(select 1 from private.mcp_report_transition_proposals where id=any(v_ids) and report_id=v_report) then
      raise exception 'invalid_report_transition' using errcode='22023';
    end if;
    v_ids := array_append(v_ids,private.prepare_mcp_report_transition(p_org,v_report,v_version,p_transition,p_reason));
  end loop;
  select min(expires_at) into v_expiry from private.mcp_report_transition_proposals where id=any(v_ids);
  insert into private.mcp_report_transition_batches(organization_id,actor_id,oauth_client_id,oauth_session_id,proposal_ids,expires_at)
    values(p_org,auth.uid(),(auth.jwt()->>'client_id')::uuid,(auth.jwt()->>'session_id')::uuid,v_ids,v_expiry) returning id into v_batch;
  return jsonb_build_object('status','confirmation_required','batch_id',v_batch,'count',cardinality(v_ids),'expires_at',v_expiry);
end $$;
revoke all on function public.prepare_mcp_report_transition_batch(uuid,jsonb,text,text) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.prepare_mcp_report_transition_batch(uuid,jsonb,text,text) to mcp_import;

create function private.review_mcp_report_transition_batch(p_batch uuid,p_confirm boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare b private.mcp_report_transition_batches%rowtype; v_id uuid; v_item jsonb; v_items jsonb := '[]'::jsonb; v_status text; v_done integer := 0;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active() or p_confirm is null then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into b from private.mcp_report_transition_batches where id=p_batch and actor_id=auth.uid() for update;
  if not found or not private.mcp_shift_update_oauth_valid(b.actor_id,b.oauth_client_id,b.oauth_session_id) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  -- Check every item before attempting changes. Any exception during the second
  -- pass aborts this RPC and rolls back previous updates, notifications and audit.
  foreach v_id in array b.proposal_ids loop
    v_item := private.review_mcp_report_transition(v_id,false);
    v_status := v_item->>'status';
    if v_status in ('expired','changed') then
      if p_confirm then raise exception 'proposal_changed' using errcode='22023'; end if;
      return jsonb_build_object('status',v_status);
    end if;
    if v_status in ('approved','remanded') then v_done := v_done+1; end if;
    v_items := v_items || jsonb_build_array(v_item - 'proposal_id');
  end loop;
  if v_done not in (0,cardinality(b.proposal_ids)) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  if v_done=cardinality(b.proposal_ids) then
    return jsonb_build_object('status','completed','count',v_done,'items',v_items,'replayed',true);
  end if;
  if not p_confirm then
    return jsonb_build_object('status','confirmation_required','batch_id',b.id,'count',cardinality(b.proposal_ids),'expires_at',b.expires_at,'items',v_items);
  end if;
  v_items := '[]'::jsonb;
  foreach v_id in array b.proposal_ids loop
    v_items := v_items || jsonb_build_array(private.review_mcp_report_transition(v_id,true));
  end loop;
  return jsonb_build_object('status','completed','count',cardinality(b.proposal_ids),'items',v_items,'replayed',false);
end $$;
revoke all on function private.review_mcp_report_transition_batch(uuid,boolean) from public,anon,authenticated,service_role,mcp_import;
create function public.get_mcp_report_transition_batch_review(p_batch uuid)
returns jsonb language sql volatile security definer set search_path='' as $$ select private.review_mcp_report_transition_batch(p_batch,false) $$;
create function public.confirm_mcp_report_transition_batch(p_batch uuid)
returns jsonb language sql volatile security definer set search_path='' as $$ select private.review_mcp_report_transition_batch(p_batch,true) $$;
revoke all on function public.get_mcp_report_transition_batch_review(uuid),public.confirm_mcp_report_transition_batch(uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_report_transition_batch_review(uuid),public.confirm_mcp_report_transition_batch(uuid) to authenticated;

create function public.get_mcp_report_transition_batch_result(p_org uuid,p_batch uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare b private.mcp_report_transition_batches%rowtype; v_id uuid; v_item jsonb; v_items jsonb := '[]'::jsonb; v_done integer := 0;
begin
  perform private.assert_mcp_record_read(p_org);
  select * into b from private.mcp_report_transition_batches where id=p_batch and organization_id=p_org and actor_id=auth.uid()
    and oauth_client_id::text=auth.jwt()->>'client_id' and oauth_session_id::text=auth.jwt()->>'session_id';
  if not found then return null; end if;
  foreach v_id in array b.proposal_ids loop
    v_item := public.get_mcp_report_transition_result(p_org,v_id);
    if v_item is null then return null; end if;
    if v_item->>'status' in ('expired','changed') then return jsonb_build_object('status',v_item->>'status'); end if;
    if v_item->>'status' in ('approved','remanded') then v_done := v_done+1; end if;
    v_items := v_items || jsonb_build_array(v_item);
  end loop;
  if v_done=cardinality(b.proposal_ids) then return jsonb_build_object('status','completed','count',v_done,'items',v_items); end if;
  if v_done<>0 then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  return jsonb_build_object('status','confirmation_required','count',cardinality(b.proposal_ids));
end $$;
revoke all on function public.get_mcp_report_transition_batch_result(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;
grant execute on function public.get_mcp_report_transition_batch_result(uuid,uuid) to mcp_import;
notify pgrst, 'reload schema';
