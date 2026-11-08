-- Confirmed correction proposals remain available to the author in the app,
-- even after the external OAuth connection has been revoked. Current browser
-- authentication, membership and both record permissions still apply.
create function private.list_mcp_record_correction_proposals(p_org uuid, p_limit integer, p_offset integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not private.is_session_active()
    or not private.is_org_member(p_org) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'invalid_pagination' using errcode = '22023';
  end if;
  perform pg_catalog.set_config('lock_timeout','5s',true);
  perform 1 from public.organizations where id = p_org and deleted_at is null for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  perform 1 from public.organization_members where organization_id = p_org and user_id = auth.uid() for share;
  if not found then raise exception 'proposal_unavailable' using errcode = '42501'; end if;
  lock table public.organization_member_roles, public.organization_roles, public.assignments in share mode;
  perform 1 from public.user_session_activity where user_id = auth.uid() and auth_session_id = auth.jwt()->>'session_id'
    and revoked_at is null and last_activity >= clock_timestamp() - interval '24 hours'
    and absolute_expires_at > clock_timestamp() for share;
  if not found or not private.is_session_active() or not private.is_org_member(p_org) then
    raise exception 'proposal_unavailable' using errcode = '42501';
  end if;
  lock table public.clients, public.reports in share mode;
  select jsonb_build_object('proposals',coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'report_id',q.report_id,'client_name',q.client_name,'confirmed_at',q.confirmed_at,
    'base_version',q.expected_version) order by q.confirmed_at desc,q.id),'[]'::jsonb),
    'has_more',count(*) > p_limit,'limit',p_limit,'offset',p_offset)
  into v_result from (
    select p.id,p.report_id,p.confirmed_at,p.expected_version,c.name as client_name
    from private.mcp_record_edit_proposals p
    join public.reports r on r.id = p.report_id and r.deleted_at is null
    join public.clients c on c.id = r.client_id and c.organization_id = p_org and c.deleted_at is null
    where p.organization_id = p_org and p.actor_id = auth.uid() and p.confirmed_at is not null
      and p.result->>'status' = 'correction_proposed'
      and private.can_access_report(r.id)
      and private.can_record_action_for_client(p_org,c.id,'view')
      and private.can_record_action_for_client(p_org,c.id,'edit')
    order by p.confirmed_at desc,p.id limit p_limit + 1 offset p_offset
  ) q;
  if (v_result->>'has_more')::boolean then
    v_result := jsonb_set(v_result,'{proposals}',(v_result->'proposals') - p_limit);
  end if;
  return v_result;
end $$;
revoke all on function private.list_mcp_record_correction_proposals(uuid,integer,integer)
  from public, anon, authenticated, service_role, mcp_import;
