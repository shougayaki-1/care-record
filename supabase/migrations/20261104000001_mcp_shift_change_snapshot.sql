-- Internal conflict token for a future confirmed shift update. It is not an
-- authorization check: callers must lock the relevant rows and reauthorize.
-- Include child rows because editing a segment or assignment may otherwise
-- leave the parent timestamp unchanged. Never expose the snapshot to MCP.
create function private.mcp_shift_change_snapshot(p_organization_id uuid, p_shift_id uuid)
returns bytea
language sql stable security invoker
set search_path = ''
set timezone = 'UTC'
as $$
  select extensions.digest(convert_to(jsonb_build_object(
    'shift', to_jsonb(s) - array['google_event_id', 'google_sync_status', 'google_sync_error', 'google_synced_at'],
    'staffs', coalesce((select jsonb_agg(to_jsonb(ss) order by ss.staff_id)
      from public.shift_staffs ss where ss.shift_id = s.id), '[]'::jsonb),
    'segments', coalesce((select jsonb_agg(jsonb_build_object(
      'segment', to_jsonb(seg),
      'staffs', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
        from public.shift_segment_staffs x where x.segment_id = seg.id), '[]'::jsonb)
    ) order by seg.id) from public.shift_segments seg where seg.shift_id = s.id), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256')
  from public.shifts s
  where s.organization_id = p_organization_id and s.id = p_shift_id
$$;
revoke all on function private.mcp_shift_change_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role, mcp_import;
