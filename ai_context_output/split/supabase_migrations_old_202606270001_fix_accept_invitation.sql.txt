-- Fix accept_invitation_atomic:
-- 1. ON CONFLICT (col) → ON CONFLICT DO NOTHING (no constraint spec required)
-- 2. Restore already_member check to avoid consuming invitations for existing members
-- 3. Restore profiles.last_organization_id update
-- 4. Restore audit event recording
-- 5. Add NULL guard for role_ids
-- 6. Use invitation id (not code) for the is_used update to be precise

CREATE OR REPLACE FUNCTION public.accept_invitation_atomic(p_code text, p_session_id text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inv   public.invitations%ROWTYPE;
  v_role_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_inv
    FROM public.invitations
   WHERE code = p_code
     AND is_used = false
     AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_invalid'; END IF;

  -- 既参加チェック: 招待を消費せず例外を返す
  IF EXISTS (
    SELECT 1 FROM public.organization_members
     WHERE organization_id = v_inv.organization_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  -- メンバー追加 (constraint 指定なし → 任意の PK/UNIQUE で動作)
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_inv.organization_id, v_actor, 'member')
  ON CONFLICT DO NOTHING;

  -- ロール割り当て
  IF v_inv.role_ids IS NOT NULL THEN
    FOREACH v_role_id IN ARRAY v_inv.role_ids LOOP
      INSERT INTO public.organization_member_roles (organization_id, user_id, role_id)
      VALUES (v_inv.organization_id, v_actor, v_role_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- 担当クライアント割り当て
  IF v_inv.target_client_ids IS NOT NULL THEN
    INSERT INTO public.assignments (client_id, helper_id)
    SELECT elem::uuid, v_actor
      FROM jsonb_array_elements_text(to_jsonb(v_inv.target_client_ids)) AS elem
    ON CONFLICT DO NOTHING;
  END IF;

  -- 招待を消費済みにする (id で特定)
  UPDATE public.invitations SET is_used = true WHERE id = v_inv.id AND is_used = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_already_used'; END IF;

  -- 最終事業所を記録
  UPDATE public.profiles SET last_organization_id = v_inv.organization_id WHERE id = v_actor;

  -- 監査ログ
  INSERT INTO public.audit_events (organization_id, actor_id, action_type, resource_type, resource_id, outcome, session_id, details)
  VALUES (
    v_inv.organization_id, v_actor,
    'account.invitation_accept', 'invitation', v_inv.id::text,
    'success', p_session_id,
    jsonb_build_object('role', 'member', 'role_ids', to_jsonb(v_inv.role_ids))
  );

  RETURN v_inv.organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_atomic(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation_atomic(text, text) TO authenticated;
