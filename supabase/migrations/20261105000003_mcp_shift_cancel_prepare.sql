-- Internal preparation only; no application or MCP role can invoke this yet.
-- A later confirmation path must reauthorize, lock, compare, audit, and mutate.
create function private.mcp_shift_cancel_references(p_org uuid, p_shift uuid)
returns jsonb language sql stable security invoker set search_path = '' set timezone = 'UTC' as $$
  with staff_ids as (
    select staff_id as id from public.shift_staffs where shift_id=p_shift
    union select x.staff_id from public.shift_segments seg join public.shift_segment_staffs x on x.segment_id=seg.id where seg.shift_id=p_shift
  )
  select jsonb_build_object(
    'organization', jsonb_build_object('id',o.id,'name',o.name,'deleted_at',o.deleted_at),
    'client', jsonb_build_object('id',c.id,'name',c.name,'deleted_at',c.deleted_at,'archived_at',c.archived_at),
    'staffs', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',st.name,'deleted_at',st.deleted_at,'archived_at',st.archived_at) order by i.id)
      from staff_ids i left join public.staffs st on st.id=i.id and st.organization_id=p_org),'[]'::jsonb))
  from public.shifts s join public.organizations o on o.id=s.organization_id
    join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
  where s.id=p_shift and s.organization_id=p_org
$$;
revoke all on function private.mcp_shift_cancel_references(uuid,uuid) from public,anon,authenticated,service_role,mcp_import;

create function private.prepare_mcp_shift_cancel(p_org uuid,p_shift uuid,p_operation text,p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare s public.shifts%rowtype; v_refs jsonb; v_before jsonb; v_snapshot bytea; v_id uuid; v_action text;
begin
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform private.assert_mcp_shift_read(p_org);
  if p_operation is null or p_operation not in ('cancel','soft_delete') or p_reason is null or char_length(p_reason)>500 then
    raise exception 'invalid_shift_proposal' using errcode='22023';
  end if;
  v_action := case p_operation when 'cancel' then 'edit' else 'delete' end;
  perform 1 from public.organizations where id=p_org and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  lock table public.organization_member_roles,public.organization_roles,public.assignments in share mode;
  lock table public.staffs,public.clients in share mode;
  lock table public.shifts,public.shift_segments,public.shift_segment_staffs,public.shift_staffs,public.reports,public.report_shifts in share mode;
  perform private.assert_mcp_shift_read(p_org);
  if private.get_member_shift_action_scope(p_org,auth.uid(),'view') is distinct from 'all'
    or private.get_member_shift_action_scope(p_org,auth.uid(),v_action) is distinct from 'all'
    or not exists(select 1 from private.mcp_shift_cancel_controls where organization_id=p_org and enabled)
    or not exists(select 1 from private.mcp_person_search_controls where organization_id=p_org and enabled) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  select * into s from public.shifts where id=p_shift and organization_id=p_org and deleted_at is null;
  if not found or (p_operation='cancel' and s.status='cancelled') or not private.can_access_shift(s.id)
    or not private.can_access_client(s.client_id) then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  v_refs := private.mcp_shift_cancel_references(p_org,p_shift);
  if v_refs is null or nullif(v_refs->'organization'->>'name','') is null or v_refs->'organization'->>'deleted_at' is not null
    or nullif(v_refs->'client'->>'name','') is null or v_refs->'client'->>'deleted_at' is not null
    or exists(select 1 from jsonb_array_elements(v_refs->'staffs') x where nullif(x->>'name','') is null or x->>'deleted_at' is not null) then
    raise exception 'proposal_unavailable' using errcode='42501';
  end if;
  v_snapshot := private.mcp_shift_cancel_snapshot(p_org,p_shift);
  v_before := jsonb_build_object('id',s.id,'title',s.title,'start_at',s.start_at,'end_at',s.end_at,'status',s.status,
    'linked_report_count',(select count(distinct r.id) from public.reports r where r.deleted_at is null and
      (r.shift_id=s.id or exists(select 1 from public.report_shifts rs where rs.report_id=r.id and rs.shift_id=s.id)
      or exists(select 1 from public.shift_segments seg where seg.id=r.segment_id and seg.shift_id=s.id))));
  if v_snapshot is null or not private.is_mcp_oauth_active() then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp_shift_cancel:'||auth.uid()::text,0));
  if (select count(*) from private.mcp_shift_cancel_proposals where actor_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour')>=50 then
    raise exception 'proposal_limit' using errcode='54000';
  end if;
  if not private.is_mcp_oauth_active() then raise exception 'proposal_unavailable' using errcode='42501'; end if;
  insert into private.mcp_shift_cancel_proposals(organization_id,actor_id,oauth_client_id,oauth_session_id,shift_id,original_snapshot,before_content,operation,reason,reference_content)
    values(p_org,auth.uid(),(auth.jwt()->>'client_id')::uuid,(auth.jwt()->>'session_id')::uuid,p_shift,v_snapshot,v_before,p_operation,p_reason,v_refs)
    returning id into v_id;
  return v_id;
end $$;
revoke all on function private.prepare_mcp_shift_cancel(uuid,uuid,text,text) from public,anon,authenticated,service_role,mcp_import;
