-- New reports get a search date at insert, before the existing version trigger.
-- Existing rows are not modified; the read path below handles legacy NULL dates.
create function private.set_report_service_date_on_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.service_date is null and new.start_at is not null then
    new.service_date := (new.start_at at time zone 'Asia/Tokyo')::date;
  end if;
  return new;
end $$;
revoke all on function private.set_report_service_date_on_insert() from public, anon, authenticated, service_role;
create trigger reports_set_service_date_on_insert before insert on public.reports
for each row execute function private.set_report_service_date_on_insert();

create or replace function public.list_mcp_records(p_organization_id uuid, p_start date, p_end date,
 p_client_id uuid default null, p_staff_id uuid default null, p_status text default null,
 p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
 perform private.assert_mcp_record_read(p_organization_id);
 if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365
   or p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000
   or (p_status is not null and p_status not in ('draft','pending','approved','remanded')) then
   raise exception 'invalid_record_query' using errcode = '22023';
 end if;
 select jsonb_build_object('records', coalesce(jsonb_agg(jsonb_build_object(
   'id', q.id, 'client_id', q.client_id, 'helper_id', q.helper_id, 'service_date', q.effective_service_date,
   'start_at', q.start_at, 'end_at', q.end_at, 'status', q.status,
   'current_version', q.current_version, 'current_revision_id', q.current_revision_id,
   'approved_at', q.approved_at) order by q.effective_service_date desc, q.id), '[]'::jsonb),
   'has_more', count(*) > p_limit, 'limit', p_limit, 'offset', p_offset)
 into v_result from (
   select r.*, coalesce(r.service_date, (r.start_at at time zone 'Asia/Tokyo')::date) as effective_service_date from public.reports r join public.clients c on c.id=r.client_id
   where c.organization_id=p_organization_id and r.deleted_at is null and private.can_access_report(r.id)
     and coalesce(r.service_date, (r.start_at at time zone 'Asia/Tokyo')::date) between p_start and p_end
     and (p_client_id is null or r.client_id=p_client_id)
     and (p_staff_id is null or exists (select 1 from public.staffs st where st.id=p_staff_id and st.organization_id=p_organization_id and st.user_id=r.helper_id) or exists
       (select 1 from public.report_actual_staffs ras where ras.report_id=r.id and ras.staff_id=p_staff_id))
     and (p_status is null or r.status=p_status)
   order by coalesce(r.service_date, (r.start_at at time zone 'Asia/Tokyo')::date) desc, r.id limit p_limit+1 offset p_offset
 ) q;
 if (v_result->>'has_more')::boolean then v_result := jsonb_set(v_result, '{records}', (v_result->'records') - p_limit); end if;
 return v_result;
end $$;
revoke all on function public.list_mcp_records(uuid,date,date,uuid,uuid,text,integer,integer) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.list_mcp_records(uuid,date,date,uuid,uuid,text,integer,integer) to mcp_import;
