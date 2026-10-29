-- Return only an authorized record and, independently, a visible linked shift.
create function public.get_mcp_record_quality_source(p_organization_id uuid, p_record_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_report public.reports%rowtype; v_schema jsonb; v_values jsonb; v_shift jsonb; v_staff_count integer; v_links integer;
begin
  perform private.assert_mcp_record_read(p_organization_id);
  select r.* into v_report from public.reports r join public.clients c on c.id=r.client_id
    where r.id=p_record_id and c.organization_id=p_organization_id and r.deleted_at is null and private.can_access_report(r.id);
  if not found then return null; end if;
  select f.schema into v_schema from public.form_templates f where f.client_id=v_report.client_id;
  select rv.data into v_values from public.report_values rv where rv.report_id=v_report.id;
  select count(*) into v_staff_count from public.report_actual_staffs a where a.report_id=v_report.id;
  select count(*) into v_links from public.report_shifts rs where rs.report_id=v_report.id;
  if v_report.shift_id is not null and exists (select 1 from private.mcp_shift_read_controls where organization_id=p_organization_id and enabled)
     and private.get_member_shift_action_scope(p_organization_id, auth.uid(), 'view') is distinct from 'none' then
    select jsonb_build_object('id',s.id,'client_matches',s.client_id=v_report.client_id,
      'start_at',case when v_report.segment_id is null then s.start_at else seg.start_at end,
      'end_at',case when v_report.segment_id is null then s.end_at else seg.end_at end,
      'status',s.status)
    into v_shift from public.shifts s
    left join public.shift_segments seg on seg.id=v_report.segment_id and seg.shift_id=s.id
    where s.id=v_report.shift_id and s.organization_id=p_organization_id and s.deleted_at is null
      and private.can_access_shift_row(s.id,s.organization_id,s.client_id,s.deleted_at);
  end if;
  return jsonb_build_object('record_id',v_report.id,'service_date',v_report.service_date,
    'start_at',v_report.start_at,'end_at',v_report.end_at,'values',coalesce(v_values,'{}'::jsonb),
    'template',v_schema,'actual_staff_count',v_staff_count,'linked_shift_count',v_links,'shift',v_shift);
end $$;
revoke all on function public.get_mcp_record_quality_source(uuid,uuid) from public, anon, authenticated, service_role, mcp_import;
grant execute on function public.get_mcp_record_quality_source(uuid,uuid) to mcp_import;
