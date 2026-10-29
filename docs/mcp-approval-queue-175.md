# MCP 承認キュー（#175）

`list_approval_queue` は事業所と JST のサービス日（両端含む、最大366日）を指定し、画面の「未承認・差戻し」と同じ pending / remanded を参照する。状態別件数は期間全体を対象とし、任意の状態指定は一覧だけに適用する。ページは最大100件、offset方式で、本文を含まない。画面の期間条件は開始・終了時刻に基づくため、サービス日で絞る本ツールとは日をまたぐ記録などで差が生じうる。

既存の記録参照と同じ既定off設定、OAuth、事業所所属、記録閲覧権限、担当範囲をDBで検証する。状態の更新・承認・差戻しは行わない。RLSとpermissionsは変更していない。実環境へのmigration・MCP関数配備、実認証試験、機能有効化は未実施。

2026-10-29: Context7 は利用枠上限のため Supabase公式の [DB関数](https://supabase.com/docs/guides/database/functions)・[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) を確認。CLI 2.108.0で合成ローカルDBを検証。
