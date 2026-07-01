--- START OF FILE supabase/migrations/202606300014_fix_accept_invitation_type_cast.sql ---
-- 前回の save_report_atomic 修正と同様に、
-- accept_invitation_atomic 内部での型解決の曖昧さ（uuidの暗黙キャスト、jsonbの扱いなど）に起因する
-- 500 Internal Server Error (function does not exist) を解消します。

CREATE OR REPLACE FUNCTION public.accept_invitation_atomic(p_code text, p_session_id text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_inv public.invitations%ROWTYPE;
  v_role_id uuid;
  v_existing_profile_name text;
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

  -- メンバー追加
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

  -- 担当クライアント割り当て（jsonb から抽出する場合の安全なキャスト）
  IF v_inv.target_client_ids IS NOT NULL AND jsonb_typeof(v_inv.target_client_ids) = 'array' THEN
    INSERT INTO public.assignments (client_id, helper_id)
    SELECT elem::uuid, v_actor
      FROM jsonb_array_elements_text(v_inv.target_client_ids) AS elem
    ON CONFLICT DO NOTHING;
  END IF;

  -- プロファイル名取得
  SELECT name INTO v_existing_profile_name
    FROM public.profiles
   WHERE id = v_actor;

  -- プロファイルの更新（型の曖昧さを ::text で排除）
  INSERT INTO public.profiles (id, name, last_organization_id)
  VALUES (
    v_actor,
    COALESCE(
      NULLIF(trim(v_existing_profile_name::text), ''),
      NULLIF(trim(v_inv.target_name::text), '')
    ),
    v_inv.organization_id
  )
  ON CONFLICT (id) DO UPDATE SET
    name = CASE
      WHEN NULLIF(trim(profiles.name::text), '') IS NULL
        THEN EXCLUDED.name
      ELSE profiles.name
    END,
    last_organization_id = EXCLUDED.last_organization_id;

  -- スタッフ名簿への紐付け
  IF v_inv.staff_id IS NOT NULL THEN
    UPDATE public.staffs
       SET user_id = v_actor
     WHERE id = v_inv.staff_id
       AND organization_id = v_inv.organization_id
       AND user_id IS NULL
       AND deleted_at IS NULL;
  END IF;

  -- 招待の使用フラグ更新
  UPDATE public.invitations SET is_used = true WHERE id = v_inv.id AND is_used = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_already_used'; END IF;

  -- 監査ログの記録（uuid等のキャストを明示して jsonb_build_object での解決エラーを防止）
  INSERT INTO public.audit_events (organization_id, actor_id, action_type, resource_type, resource_id, outcome, session_id, details)
  VALUES (
    v_inv.organization_id, v_actor,
    'account.invitation_accept', 'invitation', v_inv.id::text,
    'success', p_session_id,
    jsonb_build_object(
      'role', 'member',
      'role_ids', to_jsonb(v_inv.role_ids::uuid[]),
      'staff_id', v_inv.staff_id::text,
      'profileNameInitialized', NULLIF(trim(COALESCE(v_existing_profile_name::text, '')), '') IS NULL
    )
  );

  RETURN v_inv.organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation_atomic(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation_atomic(text, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
--- END OF FILE supabase/migrations/202606300014_fix_accept_invitation_type_cast.sql ---