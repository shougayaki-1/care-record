-- Bug 2: accept_invitation_atomic — 既参加ユーザーが招待を消費しないよう修正
-- 既参加の場合は invitation を is_used=true にせず already_member 例外を発生させる
CREATE OR REPLACE FUNCTION public.accept_invitation_atomic(p_code text, p_session_id text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  invite public.invitations%ROWTYPE;
  granted_role text;
  client_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO invite FROM public.invitations i
   WHERE i.code=p_code AND i.is_used=false AND i.expires_at>now() FOR UPDATE;
  IF invite.id IS NULL THEN RAISE EXCEPTION 'invitation_invalid'; END IF;

  -- 既参加チェック: 招待を消費せず例外を返す
  IF EXISTS(
    SELECT 1 FROM public.organization_members
     WHERE organization_id=invite.organization_id AND user_id=actor
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  granted_role := CASE WHEN invite.role IN ('manager','staff') THEN invite.role ELSE 'staff' END;
  UPDATE public.invitations SET is_used=true WHERE id=invite.id AND is_used=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_already_used'; END IF;
  INSERT INTO public.organization_members(organization_id,user_id,role)
    VALUES(invite.organization_id,actor,granted_role);
  IF invite.target_client_ids IS NOT NULL THEN
    FOR client_id IN SELECT jsonb_array_elements_text(to_jsonb(invite.target_client_ids))::uuid LOOP
      IF EXISTS(SELECT 1 FROM public.clients c WHERE c.id=client_id AND c.organization_id=invite.organization_id) THEN
        INSERT INTO public.assignments(helper_id,client_id) VALUES(actor,client_id) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  UPDATE public.profiles SET last_organization_id=invite.organization_id WHERE id=actor;
  INSERT INTO public.audit_events(organization_id,actor_id,action_type,resource_type,resource_id,outcome,session_id,details)
    VALUES(invite.organization_id,actor,'account.invitation_accept','invitation',invite.id::text,'success',p_session_id,
      jsonb_build_object('role',granted_role));
  RETURN invite.organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_invitation_atomic(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation_atomic(text,text) TO authenticated;

-- Bug 3: オーナー移譲を単一トランザクション内で原子的に処理する RPC
-- 2回の UPDATE を分けて呼ぶと中間状態（2オーナー）が発生しうるため関数化
CREATE OR REPLACE FUNCTION public.transfer_owner_atomic(
  p_org_id uuid,
  p_new_owner_id uuid,
  p_current_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 同一人物への譲渡は禁止
  IF p_new_owner_id = p_current_owner_id THEN
    RAISE EXCEPTION 'invalid_transfer_target';
  END IF;
  -- 譲渡先がメンバーであることを確認
  IF NOT EXISTS(
    SELECT 1 FROM public.organization_members
     WHERE organization_id=p_org_id AND user_id=p_new_owner_id
  ) THEN
    RAISE EXCEPTION 'target_not_member';
  END IF;
  -- 現オーナーが実際に owner であることを確認
  IF NOT EXISTS(
    SELECT 1 FROM public.organization_members
     WHERE organization_id=p_org_id AND user_id=p_current_owner_id AND role='owner'
  ) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  -- 単一トランザクション内で両方更新
  UPDATE public.organization_members SET role='owner'
   WHERE organization_id=p_org_id AND user_id=p_new_owner_id;
  UPDATE public.organization_members SET role='manager'
   WHERE organization_id=p_org_id AND user_id=p_current_owner_id;
END;
$$;
-- service_role（supabaseAdmin）のみ実行可能
REVOKE ALL ON FUNCTION public.transfer_owner_atomic(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_owner_atomic(uuid,uuid,uuid) TO service_role;

-- Bug 6: 同一アカウントを複数スタッフに紐付けることを DB レベルで禁止
-- deleted_at IS NULL の有効レコードのみに一意制約を適用
CREATE UNIQUE INDEX IF NOT EXISTS staffs_active_user_unique_idx
  ON public.staffs (organization_id, user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;
