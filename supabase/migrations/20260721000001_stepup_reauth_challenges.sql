-- SSOのみ（パスワード未設定）のアカウントが、重要操作の再認証をGoogle/Microsoftへの
-- 再ログイン（step-up認証）で行えるようにするためのチャレンジ管理テーブル。
-- oauth_nonces と同じ「nonceをhttpOnly Cookieとリダイレクト先URLの両方に載せ、
-- DBで一度きり消費する」パターンを踏襲する。発行された再認証グラント自体は
-- 引き続き reauth_grants に記録され、consumeReauthGrant 側の検証は変更しない。

CREATE TABLE IF NOT EXISTS public.stepup_reauth_challenges (
  nonce_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN (
    'owner_transfer',
    'organization_delete',
    'external_secret_change',
    'backup_restore'
  )),
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);

ALTER TABLE public.stepup_reauth_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stepup_reauth_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stepup_reauth_challenges TO service_role;

CREATE INDEX IF NOT EXISTS stepup_reauth_challenges_expiry_idx
  ON public.stepup_reauth_challenges (expires_at)
  WHERE consumed_at IS NULL;
