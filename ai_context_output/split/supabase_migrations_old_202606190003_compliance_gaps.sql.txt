-- 3省2ガイドライン準拠ギャップの是正（基盤スキーマ）
-- 1) 認証イベント（ログイン/ログアウト）を監査できるよう audit_events.organization_id を NULL 許容化
-- 2) ログイン試行のレート制限・ロックアウト用の login_attempts テーブルを新設
-- アプリケーション更新と同時に適用すること。

-- 1) 認証イベントは組織コンテキスト未確定でも記録できる必要があるため NULL を許容する。
--    既存の NOT NULL 前提コード（recordAuditEvent 経由の通常記録）は organization_id を渡し続けるため影響なし。
ALTER TABLE public.audit_events
  ALTER COLUMN organization_id DROP NOT NULL;

-- 2) ログイン試行記録（IPはハッシュ化して保存。生IPは保持しない）。
--    audit_events と同様、追記専用・service_role のみアクセス可とする。
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text,
  email_hash text,
  outcome text NOT NULL DEFAULT 'failure' CHECK (outcome IN ('success', 'failure')),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- レート制限の集計用（直近の失敗回数を ip_hash と時間窓で素早く数える）。
CREATE INDEX IF NOT EXISTS login_attempts_ip_created_idx
  ON public.login_attempts (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_email_created_idx
  ON public.login_attempts (email_hash, created_at DESC);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_attempts FROM anon, authenticated;
-- 監査ログとは異なりレート制限のための一時データなので、古い行は purge cron で掃除する
-- （追記専用トリガは付けない＝service_role による定期削除を許可する）。
