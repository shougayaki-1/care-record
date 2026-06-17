-- =============================================================================
-- RLS セキュリティ修正 SQL（Supabase SQL Editor で実行）
--
-- 前提・注意:
--  * エクスポートされた既存ポリシーは、SELECT に WITH CHECK が付くなど
--    USING / WITH CHECK 列が入れ替わって表示されていた（PostgreSQL では
--    SELECT に WITH CHECK は付けられない）。実際の述語は USING 側にある。
--  * アプリの特権処理は service_role（RLS バイパス）のサーバーアクションへ
--    移行済み。以下はクライアント anon キーからの PostgREST 直叩きを塞ぐもの。
--  * 実行前に各テーブルで RLS が ENABLE されていることを確認すること:
--      ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
-- =============================================================================


-- 🔴 CRITICAL #1: organization_members への自己挿入（任意ロール化）を禁止
-- ---------------------------------------------------------------------------
-- 旧: WITH CHECK ((user_id = auth.uid()) OR is_org_admin(organization_id))
--   → 認証ユーザーが {organization_id: 任意, user_id: 自分, role: 'owner'} を
--     直接 INSERT でき、任意の事業所のオーナーになれてしまう。
-- 新: メンバー追加は管理者のみ。自己参加は acceptInvitation サーバーアクション
--     (service role) 経由に限定する。
DROP POLICY IF EXISTS "Insert members" ON public.organization_members;
CREATE POLICY "Admins insert members" ON public.organization_members
    FOR INSERT TO authenticated
    WITH CHECK (is_org_admin(organization_id));
-- 注: 新規事業所作成時の最初のオーナー登録は RPC create_organization が
--     SECURITY DEFINER で行う想定。そうでない場合は RPC 側を SECURITY DEFINER 化すること。


-- 🟠 HIGH #2: 招待コードの全件漏えいを防ぐ
-- ---------------------------------------------------------------------------
-- 旧: SELECT USING (is_org_admin(organization_id) OR (is_used = false))
--   → is_used=false の枝が auth を参照しないため、anon を含む誰でも
--     未使用招待（code, target_name 等）を全事業所横断で読めた。
-- 新: 招待の閲覧は当該事業所の管理者のみ。コード検証は acceptInvitation
--     サーバーアクション (service role) が行うのでクライアント参照は不要。
DROP POLICY IF EXISTS "Read invitations" ON public.invitations;
CREATE POLICY "Read invitations" ON public.invitations
    FOR SELECT TO authenticated
    USING (is_org_admin(organization_id));

-- 重複ポリシーの整理（"Create invitations" と同一の INSERT 条件）
DROP POLICY IF EXISTS "Insert invitations" ON public.invitations;

-- join をサーバーアクション化したため、参加者がクライアントから招待を
-- UPDATE する必要はなくなる。攻撃面を減らすため削除（管理者用 "Admin update
-- invitations" は残す）。
DROP POLICY IF EXISTS "Joiner accept invitation" ON public.invitations;


-- 🟡 MEDIUM #3: 任意ユーザー宛の通知挿入を禁止
-- ---------------------------------------------------------------------------
-- 旧: INSERT WITH CHECK (true) / TO public
--   → anon 含め誰でも任意の user_id 宛に通知を挿入できた（なりすまし/フィッシング）。
-- クライアントは通知を INSERT しない（自分宛の既読更新のみ）。
-- 通知作成はサーバー(service role)/トリガー経由のみとする。
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
-- 注: 通知を作る DB トリガー関数がある場合は SECURITY DEFINER であることを確認。


-- 🟡 任意（要確認）: メンバーによる shifts / staffs の直接作成を管理者に限定したい場合
-- ---------------------------------------------------------------------------
-- 現状は admin 用ポリシーと「任意メンバーが作成可」ポリシーが OR で併存し、
-- 実質どのメンバーでも INSERT できる。シフト/職員管理を管理者専用にする意図なら
-- 以下を削除する（アプリ本体はサーバーアクション経由なので影響なし）。
-- DROP POLICY IF EXISTS "Users can insert shifts in their organization" ON public.shifts;
-- DROP POLICY IF EXISTS "Users can insert staffs in their org" ON public.staffs;


-- =============================================================================
-- 実行後の確認用クエリ
-- =============================================================================
-- 1) 各テーブルで RLS が有効か:
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';
--
-- 2) 残存ポリシーの USING(qual) / WITH CHECK(with_check) を正しい列で確認:
--    SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
--    FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
--
--    特に "Manage *"（FOR ALL）系で qual(USING) が NULL になっていないか確認する。
--    NULL の場合、管理者でも UPDATE/DELETE 時の行可視性が無く操作が通らないため、
--    USING (is_org_admin(...)) を明示的に設定し直すこと。
-- =============================================================================
