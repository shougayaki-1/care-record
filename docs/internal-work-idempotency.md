# 内勤保存の冪等性（Issue #47）

`saveInternalWork` は UUID の `idempotencyKey` を必須とし、session client から `save_internal_work_idempotent` を呼ぶ。通常記録の `report_mutation_keys` と同じ組織・実行者・キーの境界と payload hash の契約を、内勤専用台帳へ適用する。通常記録の RPC は変更しない。

- 同じ組織・認証済み実行者・キー・正規化した入力の再試行は同じ ID を返す。同時呼び出しはキー単位の transaction advisory lock を台帳参照前に取得し、記録・台帳・作成監査を一緒に commit する。最初の transaction が rollback した場合は待機側が作成する。
- 同じキーで担当・件名・種別・日時・時間・メモが異なれば `CR409 / idempotency_key_reused` を返す。Action は固定の利用者向けエラーへ変換する。件名・種別・メモの trim、空種別の `meeting`、空メモの null、UTC の日時、numeric の小数末尾ゼロ除去を hash に使う。
- 別の組織または別の実行者の同じキーは別の保存操作。同じ内容も新しいキーなら意図した別件として保存できる。実行者は `auth.uid()` から取得し、入力では受け付けない。
- 新規保存と replay の両方で、active session、既存 `internalWork.create` の all / assigned / none、組織内の未削除スタッフを検証する。create-only の利用者へは自分の保存 ID のみ返し、view 権限は追加しない。削除済み記録の replay は拒否し、再作成しない。
- 新規台帳は RLS を有効にし、anon / authenticated / PUBLIC の直接権限を全て剥奪する。RPC だけ authenticated に実行を許可する。既存の internal work RLS と `permissions.ts` は変更せず、RPC 内で INSERT policy と同じ条件を照合する。通常業務の service role 呼び出しは追加しない。
- 台帳は入力本文を保持せず hash と記録 ID だけを保持する。既存 report 台帳と同様にキーの期限や削除経路は追加しない。外部キーは RESTRICT とし、記録・組織・実行者の物理削除で retry 保証が消えることを防ぐ。保持・削除ポリシーや記録履歴は変更しない。
- 作成監査は既存 atomic report RPC と同様に DB 内で追記し、保存と同時に確定する。Action の `recordAuditEvent` を別 transaction で追加すると保存後の監査失敗を再送して二重監査するため、この保存経路の監査は RPC を正とする。replay は作成監査を追加しない。監査 details に入力本文は保存しない。

UI は `useAsyncRecordAction` の attempt key を使う。失敗時はキーと全入力を維持し、編集・成功・破棄でキーをクリアする。`commitRecordChange` による再取得を維持し、再試行結果を feed に append しない。再読み込みや画面の unmount を跨ぐ入力・キーの永続化は既存フォームにないため対象外。

新規 migration を先に適用し、その後アプリを更新する。キーのない旧クライアントは保存を拒否されるため、更新後の画面を再読み込みする。既存 migration は書き換えない。以下の検証では専用の使い捨てローカルDBだけに適用し、本番への適用・配備は行っていない。

## 検証

Action unit tests は検証・認可・RPC 引数・replay・応答喪失・conflict の境界を確認する。UI unit / Storybook tests は入力保持・キー再利用・編集と成功後の更新・共通 feed の重複なしを確認する。mock tests は DB の並行実行保証の証跡にはしない。

2026-10-06 に次を実行した。

- `npm run typecheck`、`npm run lint -- --max-warnings=0`、`npm run build`: 成功。
- `npm run test:unit`: 75 files / 453 tests。`npm run test:ui`: 22 files / 67 tests。テストの timeout や assertion は変更していない。
- `npm run security:service-role`: 10用途の台帳と一致。`npm run test:ci-scope`: 17 tests、`npm run test:codex-worker`: 96 tests。
- Supabase CLI 2.108.0 / PostgreSQL 17 の独立したローカルprojectを作成し、既存migrationの後に新規migrationを追加適用した。全DBテスト6 files / 145 tests（`security_hardening.test.sql`を含む）成功。その専用DBを空から再構築して同じ145 testsを再実行し成功。DB lintはwarning 0。
- 実DBから生成したpublic schemaの型定義を採用し、再生成結果との完全一致を確認した。テスト補助関数は`authenticated`への実行権限を明示した。これはtransaction内のテスト専用関数であり、製品RPCの権限を緩和していない。
- `supabase/tests/isolation/specs/internal_work_idempotency*.spec` の3 permutationを、実際の2つの`psql`接続で実行した。コンテナに`isolationtester`がなかったため、specのsetup/steps/permutationを読み込む一時Python driverを使用した。`pg_stat_activity`で再試行側のadvisory lock待機を確認してから、先行transactionをcommitまたはrollbackした。同一入力のcommit後replay、rollback後の新規作成、異なるpayloadのCR409、各結果のID、記録・台帳・監査各1件を確認した。mockによる並行実行試験ではない。

テストには合成データだけを使用し、本番環境や既存のローカルprojectには接続していない。専用stackは検証後に停止・破棄する。Playwright E2EはAGENTS.mdの明示確認待ちで未実行。review branchの自動Vercel deploymentは無効。

2026-10-04〜06 に Context7 `/supabase/supabase` で DB function の SECURITY DEFINER / INVOKER、固定 search_path、RLS、GRANT を確認。`/websites/postgresql_17` で advisory lock と READ COMMITTED の snapshot を確認した（ローカルDBの対象 major version は17）。対象 SDK は `@supabase/supabase-js` 2.91 系、ローカル Next.js 16.3.6 の Server Actions guide も確認した。依存更新は行っていない。
