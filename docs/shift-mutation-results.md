# シフト mutation の成功判定（Issue #55）

時間変更、取消・復元、通常更新は、session client + 既存RLSのUPDATEから実更新行を取得する。IDに加えて認可済みの組織と未削除条件を指定し、0件またはDBエラーなら成功監査、Google同期、success responseへ進まない。内部更新も取得できた行の組織を同期先に使う。

単体削除は現在の`deleteShift` → `deleteShiftsBatch` → `softDeleteShiftIds`を使う。削除前の再取得で対象が消失・減少した場合は拒否する。論理削除は既存の認可付き`soft_delete_shifts_atomic`のROW_COUNTを検証し、要求件数と一致した場合だけ監査とGoogle処理へ進む。`deleteShiftsDbOnly`も同じRPCを使い、直接UPDATEの0件成功を防ぐ。空バッチは明示的なno-opを維持する。

DBエラーは`sanitizeDbError`で安全化する。既存の認可、RLS、permissions、保持方針、論理削除、監査イベント、セグメント・記録との関連を維持する。RPCの認可はactive session、組織内のdelete all scope、対象アクセス確認を要求しており、今回の変更でassigned write scopeを拡張しない。migrationや権限定義の変更はない。

mainで導入済みの削除後Google同期失敗の通知・修復経路を維持する。Google同期失敗は確定済みのローカル削除と区別する。画面はAction失敗時に成功通知や再取得へ進まず、カレンダーのドラッグ・リサイズを戻す。削除失敗はモーダルへ伝えて画面を維持する。

## 検証

2026-10-06、`npm run typecheck`、`npm run lint -- --max-warnings=0`、`npm run test:unit`（92 files / 628 tests）、`npm run build`、`npm run security:service-role`、`git diff --check`を実行して成功した。mutationと画面の新規回帰テストは80件。既存の削除回帰6件と合わせた対象実行86件も成功した。DB・Google API・認可ヘルパーはunitでmockし、成功、0件、DBエラー、権限拒否、非表示の対象、削除前の対象消失、部分件数、Google同期失敗を検証する。実DBのRLS試験や外部Google接続を実行した証跡ではない。E2Eはユーザー確認が必要なためローカルでは実行しない。

## 外部仕様確認

2026-10-06、Context7のSupabase公式資料でUPDATE RETURNING、RLS、security definerのsearch_pathと明示的なEXECUTE権限を確認した。対象はリポジトリのsupabase-js 2.108.2、PostgreSQL 17、Supabase CLI 2.108.0。Next.js 16.3.6同梱のData Securityガイドも参照した。依存バージョンの移行は行わない。

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security)
