-- Read-only queue uses the same authorization and organization switch as record reads.
create function public.list_mcp_approval_queue(p_organization_id uuid, p_start date, p_end date,
 p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
 perform private.assert_mcp_record_read(p_organization_id);
 if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365
   or p_status is not null and p_status not in ('pending','remanded')
   or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000 then
   raise exception 'invalid_record_query' using errcode = '22023';
 end if;
 with visible as materialized (
   select r.id, r.client_id, r.helper_id, r.service_date, r.start_at, r.end_at, r.status
   from public.reports r join public.clients c on c.id = r.client_id
   where c.organization_id = p_organization_id and r.deleted_at is null
     and private.can_access_report(r.id) and r.service_date between p_start and p_end
     and r.status in ('pending','remanded')
 ), page as (
   select * from visible where p_status is null or status = p_status
   order by service_date desc, id limit p_limit + 1 offset p_offset
 )
 select jsonb_build_object(
   'start_date', p_start, 'end_date', p_end, 'status', p_status,
   'counts', jsonb_build_object('pending', (select count(*) from visible where status = 'pending'),
                                'remanded', (select count(*) from visible where status = 'remanded')),
   'records', coalesce((select jsonb_agg(to_jsonb(p) order by p.service_date desc, p.id) from page p), '[]'::jsonb),
   'has_more', (select count(*) > p_limit from page), 'limit', p_limit, 'offset', p_offset)
 into v_result;
 if (v_result->>'has_more')::boolean then v_result := jsonb_set(v_result, '{records}', (v_result->'records') - p_limit); end if;
 return v_result;
end $$;
revoke all on function public.list_mcp_approval_queue(uuid,date,date,text,integer,integer) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.list_mcp_approval_queue(uuid,date,date,text,integer,integer) to mcp_import;
