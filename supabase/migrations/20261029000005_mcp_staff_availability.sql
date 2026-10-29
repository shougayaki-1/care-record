-- Availability requires complete shift visibility; partial visibility cannot prove availability.
create function public.list_mcp_staff_availability(p_organization_id uuid, p_start timestamptz, p_end timestamptz, p_client_id uuid default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
 perform private.assert_mcp_shift_read(p_organization_id);
 if private.get_member_shift_action_scope(p_organization_id, auth.uid(), 'view') <> 'all'
    or not exists (select 1 from private.mcp_person_search_controls where organization_id=p_organization_id and enabled) then
   raise exception 'mcp_shift_read_unavailable' using errcode='42501';
 end if;
 if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > interval '24 hours'
    or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000 then
   raise exception 'invalid_availability_query' using errcode='22023';
 end if;
 if p_client_id is not null and not exists (select 1 from public.clients where id=p_client_id and organization_id=p_organization_id and deleted_at is null and archived_at is null and private.can_access_client(id)) then
   raise exception 'invalid_availability_query' using errcode='22023';
 end if;
 with candidates as (
   select st.id, st.name,
     exists (select 1 from public.shifts s where s.organization_id=p_organization_id and s.deleted_at is null and s.status is distinct from 'cancelled'
       and ((s.start_at < p_end and s.end_at > p_start and exists (select 1 from public.shift_staffs ss where ss.shift_id=s.id and ss.staff_id=st.id) and not exists (select 1 from public.shift_segments x join public.shift_segment_staffs xs on xs.segment_id=x.id where x.shift_id=s.id and xs.staff_id=st.id))
         or exists (select 1 from public.shift_segments seg join public.shift_segment_staffs sss on sss.segment_id=seg.id where seg.shift_id=s.id and sss.staff_id=st.id and seg.start_at < p_end and seg.end_at > p_start))) as has_overlap,
     case when p_client_id is null then null else exists (select 1 from public.assignments a where a.client_id=p_client_id and a.staff_id=st.id) end as assigned
   from public.staffs st where st.organization_id=p_organization_id and st.deleted_at is null and st.archived_at is null
   order by st.name, st.id limit p_limit+1 offset p_offset
 ), page as (select * from candidates order by name,id limit p_limit)
 select jsonb_build_object('candidates', coalesce((select jsonb_agg(jsonb_build_object('staff_id',id,'name',name,'overlap',has_overlap,'assigned_to_client',assigned,
   'status',case when has_overlap then 'overlap' else 'needs_confirmation' end) order by name,id) from page),'[]'::jsonb),
   'has_more',(select count(*) > p_limit from candidates),'limit',p_limit,'offset',p_offset,
   'unverified',jsonb_build_array('勤務予定・休暇','移動時間','資格・サービス要件','担当条件の適合性')) into v_result;
 return v_result;
end $$;
revoke all on function public.list_mcp_staff_availability(uuid,timestamptz,timestamptz,uuid,integer,integer) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.list_mcp_staff_availability(uuid,timestamptz,timestamptz,uuid,integer,integer) to mcp_import;
