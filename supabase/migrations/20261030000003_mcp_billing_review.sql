-- Missing-record candidates require full record visibility; restricted scopes cannot
-- distinguish an absent report from one the caller is not allowed to see.
create function public.list_mcp_unrecorded_shifts(p_organization_id uuid, p_start date, p_end date,
  p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.assert_mcp_record_read(p_organization_id);
  perform private.assert_mcp_shift_read(p_organization_id);
  if private.get_member_record_view_scope(p_organization_id, auth.uid()) is distinct from 'all' then
    raise exception 'mcp_billing_review_unavailable' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365
    or p_limit is null or p_limit not between 1 and 20 or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'invalid_billing_review_query' using errcode = '22023';
  end if;
  with candidates as (
    select s.id, s.client_id, s.start_at, s.end_at,
      not exists (select 1 from public.report_shifts rs join public.reports r on r.id = rs.report_id
        where rs.shift_id = s.id and r.deleted_at is null) as no_linked_record,
      exists (select 1 from public.shift_segments seg where seg.shift_id = s.id
        and not exists (select 1 from public.reports r where r.segment_id = seg.id and r.deleted_at is null)) as uncovered_segment
    from public.shifts s
    where s.organization_id = p_organization_id and s.deleted_at is null and s.status is distinct from 'cancelled'
      and s.start_at < ((p_end + 1)::timestamp at time zone 'Asia/Tokyo')
      and s.end_at > (p_start::timestamp at time zone 'Asia/Tokyo')
      and private.can_access_shift_row(s.id, s.organization_id, s.client_id, s.deleted_at)
      and private.can_access_client(s.client_id)
  ), page as (
    select * from candidates where no_linked_record or uncovered_segment
    order by start_at, id limit p_limit + 1 offset p_offset
  )
  select jsonb_build_object('shifts', coalesce(jsonb_agg(to_jsonb(p) order by p.start_at, p.id), '[]'::jsonb),
    'has_more', count(*) > p_limit, 'limit', p_limit, 'offset', p_offset) into result from page p;
  if (result->>'has_more')::boolean then result := jsonb_set(result, '{shifts}', (result->'shifts') - p_limit); end if;
  return result;
end $$;
revoke all on function public.list_mcp_unrecorded_shifts(uuid,date,date,integer,integer) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.list_mcp_unrecorded_shifts(uuid,date,date,integer,integer) to mcp_import;
notify pgrst, 'reload schema';
