-- 危険操作とロール管理を owner 固定からロール権限へ移行する。

DO $$
DECLARE
  role_rec RECORD;
  base_management jsonb;
BEGIN
  FOR role_rec IN SELECT id, permissions FROM public.organization_roles LOOP
    base_management := COALESCE(role_rec.permissions -> 'management', '{}'::jsonb);
    UPDATE public.organization_roles
    SET permissions = jsonb_set(
      role_rec.permissions,
      '{management}',
      base_management
        || jsonb_build_object(
          'roles', COALESCE((base_management ->> 'roles')::boolean, false),
          'organizationDelete', COALESCE((base_management ->> 'organizationDelete')::boolean, false),
          'ownerTransfer', COALESCE((base_management ->> 'ownerTransfer')::boolean, false)
        ),
      true
    )
    WHERE id = role_rec.id;
  END LOOP;
END;
$$;

DO $$
DECLARE
  org_rec RECORD;
  admin_role_id uuid;
  admin_perm jsonb := '{
    "records":{"view":"all","create":"all","edit":"all","delete":"all","approve":"all"},
    "shifts":{"view":"all","create":"all","edit":"all","delete":"all","approve":"all"},
    "management":{
      "staffs":true,
      "clients":true,
      "accounts":true,
      "organization":true,
      "integrations":true,
      "auditLogs":true,
      "reports":true,
      "roles":true,
      "organizationDelete":true,
      "ownerTransfer":true
    }
  }'::jsonb;
BEGIN
  FOR org_rec IN SELECT id FROM public.organizations WHERE deleted_at IS NULL LOOP
    INSERT INTO public.organization_roles (organization_id, name, color, is_preset, permissions)
    VALUES (org_rec.id, 'システム管理者', '#dc2626', true, admin_perm)
    ON CONFLICT (organization_id, name) DO UPDATE
      SET permissions = EXCLUDED.permissions,
          is_preset = true
    RETURNING id INTO admin_role_id;

    INSERT INTO public.organization_member_roles (organization_id, user_id, role_id)
    SELECT organization_id, user_id, admin_role_id
    FROM public.organization_members
    WHERE organization_id = org_rec.id
      AND role = 'owner'
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.get_member_record_view_scope(p_org_id uuid, p_user_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = private, public STABLE AS $$
  SELECT COALESCE(
    (SELECT CASE
      WHEN EXISTS (SELECT 1 FROM public.organization_member_roles omr JOIN public.organization_roles r ON r.id = omr.role_id WHERE omr.organization_id = p_org_id AND omr.user_id = p_user_id AND (r.permissions -> 'records' ->> 'view') = 'all') THEN 'all'
      WHEN EXISTS (SELECT 1 FROM public.organization_member_roles omr JOIN public.organization_roles r ON r.id = omr.role_id WHERE omr.organization_id = p_org_id AND omr.user_id = p_user_id AND (r.permissions -> 'records' ->> 'view') = 'assigned') THEN 'assigned'
      ELSE 'none'
    END FROM public.organization_members om WHERE om.organization_id = p_org_id AND om.user_id = p_user_id),
    'none'
  )
$$;
