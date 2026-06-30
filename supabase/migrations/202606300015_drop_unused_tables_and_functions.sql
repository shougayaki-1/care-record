-- 未使用テーブル・関数の削除
-- アプリ本体（.from() / .rpc()）・RLS・トリガー・cron のいずれからも参照なし。

-- audit_logs: compliance_foundation で audit_events へデータ移行済み。以降の定義・参照なし
DROP TABLE IF EXISTS public.audit_logs;

-- 以下5テーブルは 202606190006_security_hardening_compliance で作成されたが
-- アプリ機能として未実装。同ファイルの audit_archive_checkpoints は cron で使用するため残す。
DROP TABLE IF EXISTS public.compliance_evidence;
DROP TABLE IF EXISTS public.compliance_risks;
DROP TABLE IF EXISTS public.security_incidents;
DROP TABLE IF EXISTS public.backup_restore_tests;
DROP TABLE IF EXISTS public.vendor_registry;

-- get_my_org_id / is_super_admin: .rpc() 呼び出しなし、RLS・トリガーからも不使用
DROP FUNCTION IF EXISTS public.get_my_org_id();
DROP FUNCTION IF EXISTS public.is_super_admin();
