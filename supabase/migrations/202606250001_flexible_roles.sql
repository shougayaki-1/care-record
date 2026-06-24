-- 1. organization_roles table
CREATE TABLE public.organization_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text,
  is_preset       boolean NOT NULL DEFAULT false,
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- 2. organization_member_roles junction table
CREATE TABLE public.organization_member_roles (
  organization_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  role_id         uuid NOT NULL REFERENCES public.organization_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, user_id, role_id),
  CONSTRAINT fk_member FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_members(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX ON public.organization_member_roles (organization_id, user_id);

-- 3. invitations.role_ids
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS role_ids uuid[] NOT NULL DEFAULT '{}';

-- 4. Seed preset roles per org + migrate existing members
DO $$
DECLARE
  org_rec RECORD;
  mgr_id  uuid;
  stf_id  uuid;
  mgr_perm jsonb := '{"records":{"view":"all","create":"all","edit":"all","delete":"all","approve":"all"},"shifts":{"view":"all","create":"all","edit":"all","delete":"all","approve":"all"},"management":{"staffs":true,"clients":true,"accounts":false,"organization":false,"integrations":false,"auditLogs":true,"reports":true}}'::jsonb;
  stf_perm jsonb := '{"records":{"view":"assigned","create":"assigned","edit":"assigned","delete":"none","approve":"none"},"shifts":{"view":"assigned","create":"none","edit":"none","delete":"none","approve":"none"},"management":{"staffs":false,"clients":false,"accounts":false,"organization":false,"integrations":false,"auditLogs":false,"reports":false}}'::jsonb;
BEGIN
  FOR org_rec IN SELECT id FROM public.organizations LOOP
    INSERT INTO public.organization_roles (organization_id, name, color, is_preset, permissions)
    VALUES (org_rec.id, '管理者', '#6366f1', true, mgr_perm) RETURNING id INTO mgr_id;

    INSERT INTO public.organization_roles (organization_id, name, color, is_preset, permissions)
    VALUES (org_rec.id, '一般スタッフ', '#10b981', true, stf_perm) RETURNING id INTO stf_id;

    INSERT INTO public.organization_member_roles (organization_id, user_id, role_id)
    SELECT om.organization_id, om.user_id, mgr_id FROM public.organization_members om
    WHERE om.organization_id = org_rec.id AND om.role = 'manager' ON CONFLICT DO NOTHING;

    INSERT INTO public.organization_member_roles (organization_id, user_id, role_id)
    SELECT om.organization_id, om.user_id, stf_id FROM public.organization_members om
    WHERE om.organization_id = org_rec.id AND om.role = 'staff' ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- 5. Change role constraint
ALTER TABLE public.organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
UPDATE public.organization_members SET role = 'member' WHERE role IN ('manager', 'staff');
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_role_check CHECK (role IN ('owner', 'member'));

-- 6. private.get_member_record_view_scope
CREATE OR REPLACE FUNCTION private.get_member_record_view_scope(p_org_id uuid, p_user_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = private, public STABLE AS $$
  SELECT CASE
    WHEN om.role = 'owner' THEN 'all'
    WHEN EXISTS (SELECT 1 FROM public.organization_member_roles omr JOIN public.organization_roles r ON r.id = omr.role_id WHERE omr.organization_id = p_org_id AND omr.user_id = p_user_id AND (r.permissions -> 'records' ->> 'view') = 'all') THEN 'all'
    WHEN EXISTS (SELECT 1 FROM public.organization_member_roles omr JOIN public.organization_roles r ON r.id = omr.role_id WHERE omr.organization_id = p_org_id AND omr.user_id = p_user_id AND (r.permissions -> 'records' ->> 'view') = 'assigned') THEN 'assigned'
    ELSE 'none'
  END FROM public.organization_members om WHERE om.organization_id = p_org_id AND om.user_id = p_user_id
$$;

-- 7. Updated can_access_client
CREATE OR REPLACE FUNCTION private.can_access_client(p_client_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = private, public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    JOIN public.organization_members om ON om.organization_id = c.organization_id AND om.user_id = auth.uid()
    WHERE c.id = p_client_id AND c.deleted_at IS NULL AND (
      private.get_member_record_view_scope(c.organization_id, auth.uid()) = 'all'
      OR (private.get_member_record_view_scope(c.organization_id, auth.uid()) = 'assigned'
          AND EXISTS (SELECT 1 FROM public.assignments a WHERE a.client_id = p_client_id AND a.helper_id = auth.uid()))
    )
  )
$$;

-- 8. Updated accept_invitation_atomic
CREATE OR REPLACE FUNCTION public.accept_invitation_atomic(p_code text, p_session_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_inv RECORD;
  v_org_id uuid;
  v_role_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
  SELECT * INTO v_inv FROM public.invitations WHERE code = p_code AND is_used = false AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '招待コードが無効または期限切れです'; END IF;
  v_org_id := v_inv.organization_id;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (v_org_id, v_user_id, 'member') ON CONFLICT (organization_id, user_id) DO NOTHING;
  FOREACH v_role_id IN ARRAY v_inv.role_ids LOOP
    INSERT INTO public.organization_member_roles (organization_id, user_id, role_id) VALUES (v_org_id, v_user_id, v_role_id) ON CONFLICT DO NOTHING;
  END LOOP;
  IF v_inv.target_client_ids IS NOT NULL AND jsonb_array_length(v_inv.target_client_ids) > 0 THEN
    INSERT INTO public.assignments (client_id, helper_id)
    SELECT elem::uuid, v_user_id FROM jsonb_array_elements_text(v_inv.target_client_ids) AS elem ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.invitations SET is_used = true WHERE code = p_code;
  RETURN v_org_id;
END;
$$;

-- 9. Updated transfer_owner_atomic
CREATE OR REPLACE FUNCTION public.transfer_owner_atomic(p_org_id uuid, p_new_owner_id uuid, p_current_owner_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = p_org_id AND user_id = p_current_owner_id AND role = 'owner') THEN RAISE EXCEPTION 'オーナー権限がありません'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = p_org_id AND user_id = p_new_owner_id) THEN RAISE EXCEPTION '移譲先がメンバーではありません'; END IF;
  UPDATE public.organization_members SET role = 'member' WHERE organization_id = p_org_id AND user_id = p_current_owner_id;
  UPDATE public.organization_members SET role = 'owner' WHERE organization_id = p_org_id AND user_id = p_new_owner_id;
END;
$$;

-- 10. RLS for new tables
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_member_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members read roles" ON public.organization_roles FOR SELECT USING (private.is_org_member(organization_id));
CREATE POLICY "Members read own role links" ON public.organization_member_roles FOR SELECT USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = organization_member_roles.organization_id AND om.user_id = auth.uid() AND om.role = 'owner'));
REVOKE INSERT, UPDATE, DELETE ON public.organization_roles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_member_roles FROM authenticated;
CREATE INDEX ON public.organization_roles (organization_id);
