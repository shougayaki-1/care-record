-- Process each entry in a subtransaction: expected per-item validation and
-- quota errors are reported without losing other successful candidates.
-- Authentication or authorization failures abort the entire call.
create function private.submit_mcp_batch_items(p_org uuid,p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_item jsonb; v_result jsonb; v_out jsonb := '[]'::jsonb; v_index integer := 0; v_request uuid;
begin
  if not private.is_mcp_oauth_active() then raise exception 'mcp_oauth_required' using errcode='42501'; end if;
  perform 1 from public.organizations where id=p_org and deleted_at is null for share;
  if not found then raise exception 'mcp_import_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
  if not found then raise exception 'mcp_import_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles in share mode;
  if not private.is_org_member(p_org) or not exists(select 1 from private.mcp_import_controls where organization_id=p_org and enabled)
    or private.get_member_record_action_scope(p_org,auth.uid(),'create') is distinct from 'all' then
    raise exception 'mcp_import_unavailable' using errcode='42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 10 then
    raise exception 'invalid_batch' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index+1;
    begin
      if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'request_id') is distinct from 'string'
        or jsonb_typeof(v_item->'source_file_name') is distinct from 'string'
        or jsonb_typeof(v_item->'payload') is distinct from 'object'
        or jsonb_typeof(v_item->'allow_duplicate') is distinct from 'boolean'
        or (select count(*) from jsonb_object_keys(v_item)) <> 4 then
        raise exception 'invalid_candidate_payload' using errcode='22023';
      end if;
      begin v_request := (v_item->>'request_id')::uuid;
      exception when invalid_text_representation then raise exception 'invalid_candidate_payload' using errcode='22023'; end;
      v_result := private.submit_mcp_batch_item(p_org,v_request,v_item->>'source_file_name',v_item->'payload',(v_item->>'allow_duplicate')::boolean);
      v_out := v_out || jsonb_build_array(jsonb_build_object('index',v_index,'request_id',v_request) || v_result);
    exception
      when sqlstate '22023' then
        v_out := v_out || jsonb_build_array(jsonb_build_object('index',v_index,'status',case when sqlerrm='request_conflict' then 'request_conflict' else 'invalid_input' end));
      when sqlstate '54000' then
        v_out := v_out || jsonb_build_array(jsonb_build_object('index',v_index,'status','limit_reached'));
    end;
  end loop;
  return jsonb_build_object('items',v_out);
end $$;
revoke all on function private.submit_mcp_batch_items(uuid,jsonb) from public,anon,authenticated,service_role,mcp_import;
