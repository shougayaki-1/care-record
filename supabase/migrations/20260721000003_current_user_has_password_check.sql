-- Google/Microsoft SSOのみで作成したアカウントかどうかの判定を、
-- auth.users.identities の 'email' プロバイダ有無ではなく、実際に
-- パスワードが設定されているか(encrypted_password)で行うための関数。
--
-- 背景: identities に 'email' が含まれるかどうかは、パスワードの
-- 実在を正しく反映しない(後からパスワードを設定/削除しても identities
-- が追従するとは限らない)。そのため、SSOのみで再認証すべきアカウントが
-- パスワード入力を要求される、またはその逆の不具合が起きていた。
--
-- auth.users を直接読むため SECURITY DEFINER とし、呼び出し元(auth.uid())
-- 自身の情報のみ返すよう設計する(他ユーザーの情報は取得不可)。

CREATE OR REPLACE FUNCTION public.current_user_has_password()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND u.encrypted_password IS NOT NULL
      AND u.encrypted_password <> ''
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_password() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_password() TO authenticated;
