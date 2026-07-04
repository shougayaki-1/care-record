-- Fix: private.get_member_record_action_scope と get_member_record_view_scope への
--      GRANT EXECUTE が init.sql に欠落していた。
--      20260701000003_fix_report_policies.sql の RLS ポリシーがこれらを直接呼び出すため
--      authenticated ロールから permission denied になる。
GRANT EXECUTE ON FUNCTION "private"."get_member_record_action_scope"("uuid", "uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "private"."get_member_record_view_scope"("uuid", "uuid") TO "authenticated";
