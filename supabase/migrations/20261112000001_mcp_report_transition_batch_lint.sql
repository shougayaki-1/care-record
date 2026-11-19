-- Keep the existing batch contract while using an explicitly typed empty array.
create or replace function public.prepare_mcp_report_transition_batch(p_org uuid,p_records jsonb,p_transition text,p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_item jsonb; v_ids uuid[] := array[]::uuid[]; v_report uuid; v_version bigint; v_batch uuid; v_expiry timestamptz;
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
notify pgrst, 'reload schema';
