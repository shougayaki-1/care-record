-- Statistics includes internal work, so record/shift consent alone is insufficient.
-- This switch remains off until the management flow records its own conditions.
create table private.mcp_kpi_controls (
  organization_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  conditions jsonb,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  check (not enabled or (conditions is not null and confirmed_by is not null and confirmed_at is not null))
);
alter table private.mcp_kpi_controls enable row level security;
revoke all on private.mcp_kpi_controls from public, anon, authenticated, service_role, mcp_import;

-- Direct RPC callers receive the same minimum projection as the Edge Function:
-- no person/record identifiers, names, notes, or individual record values other
-- than service and travel time. It is still sensitive operational data.
create function public.get_mcp_kpi_source(p_organization_id uuid, p_month text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  month_start timestamptz; month_end timestamptz; query_start timestamptz; query_end timestamptz;
  shifts jsonb; reports jsonb; internal_work jsonb;
begin
  perform private.assert_mcp_record_read(p_organization_id);
  perform private.assert_mcp_shift_read(p_organization_id);
  if not private.has_management_permission(p_organization_id, auth.uid(), 'reports')
     or private.get_member_record_view_scope(p_organization_id, auth.uid()) is distinct from 'all'
     or private.get_member_shift_action_scope(p_organization_id, auth.uid(), 'view') is distinct from 'all'
     or not exists (select 1 from private.mcp_kpi_controls where organization_id=p_organization_id and enabled) then
    raise exception 'mcp_kpi_unavailable' using errcode='42501';
  end if;
  if p_month is null or p_month !~ '^(19[0-9]{2}|20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_kpi_month' using errcode='22023';
  end if;
  month_start := (p_month || '-01')::date::timestamp at time zone 'Asia/Tokyo';
  month_end := ((p_month || '-01')::date + interval '1 month') at time zone 'Asia/Tokyo';
  query_start := month_start - interval '1 day';
  query_end := month_end + interval '1 day' - interval '1 millisecond';

  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into shifts from (
    select s.start_at, s.end_at, coalesce(private.can_access_client(c.id) and c.name <> '', false) as client_visible,
      (select count(*) from public.shift_staffs ss where ss.shift_id=s.id) as staff_count
    from public.shifts s left join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
    where s.organization_id=p_organization_id and s.deleted_at is null and s.status <> 'cancelled'
      and s.end_at >= query_start and s.start_at <= query_end
      and private.can_access_shift_row(s.id,s.organization_id,s.client_id,s.deleted_at)
    limit 5001
  ) q;
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into reports from (
    select r.start_at, r.end_at, r.status, c.name <> '' as client_visible,
      case when jsonb_typeof(rv.data->'service_time') in ('string','number') then rv.data->'service_time' else 'null'::jsonb end as service_time,
      case when jsonb_typeof(rv.data->'travel_time') in ('string','number') then rv.data->'travel_time' else 'null'::jsonb end as travel_time,
      case when exists (select 1 from public.report_actual_staffs ras join public.staffs st on st.id=ras.staff_id
          where ras.report_id=r.id and st.organization_id=p_organization_id and st.deleted_at is null and st.name <> '')
        then (select count(*) from public.report_actual_staffs ras join public.staffs st on st.id=ras.staff_id
          where ras.report_id=r.id and st.organization_id=p_organization_id and st.deleted_at is null and st.name <> '')
        when jsonb_typeof(rv.data->'_helpers')='array' then (select count(*) from jsonb_array_elements(rv.data->'_helpers') v where v <> '""'::jsonb)
        else 0 end as staff_count
    from public.reports r join public.clients c on c.id=r.client_id and c.organization_id=p_organization_id
    left join public.report_values rv on rv.report_id=r.id
    where r.deleted_at is null and r.status in ('pending','approved','remanded')
      and r.end_at >= query_start and r.start_at <= query_end and private.can_access_report(r.id)
    limit 5001
  ) q;
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into internal_work from (
    select w.start_at, w.end_at, w.status, w.work_hours
    from public.internal_work_records w
    where w.organization_id=p_organization_id and w.deleted_at is null
      and w.end_at >= query_start and w.start_at <= query_end
    limit 5001
  ) q;
  if jsonb_array_length(shifts) + jsonb_array_length(reports) + jsonb_array_length(internal_work) > 5000
    or exists (select 1 from jsonb_array_elements(shifts || reports) v where (v->>'staff_count')::numeric > 200)
    or exists (select 1 from jsonb_array_elements(reports) v where length(v->>'service_time') > 100 or length(v->>'travel_time') > 100) then
    raise exception 'mcp_kpi_limit' using errcode='54000';
  end if;
  return jsonb_build_object('shifts', shifts, 'reports', reports, 'internal_work', internal_work);
end $$;
revoke all on function public.get_mcp_kpi_source(uuid,text) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_kpi_source(uuid,text) to mcp_import;
notify pgrst, 'reload schema';
