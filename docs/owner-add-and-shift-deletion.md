# オーナー追加とシフト削除（Issue #84 / #85）

## シフト削除

単体・一括ともDBの論理削除を先に確定する。通常の一覧・カレンダーから非表示にし、シフト本体、記録との関連、セグメントを保持する。保持方針が未承認なら削除を拒否し、オーナーへの承認依頼を画面で案内する。保持方針の検証やDB処理が失敗した場合はGoogle側を変更しない。

Google未連携は削除成功として扱う。Google認証切れ・APIエラーでもローカル削除を維持し、同期失敗を別に記録・通知する。未連携時は`pending_delete`、同期失敗時は`failed`を保持し、連携復旧後の「同期修復」でリモート予定を削除する。通常のRLSは削除済みシフトを非表示にしたまま、認可付き`get_deleted_shift_sync_targets`から同期に必要な識別子だけを取得する。権限は既存の同期RPCと同じ組織所属・active session・シフトedit/deleteのall scopeで、`permissions.ts`との対応に変更はない。

物理削除は提供しない。保持期限後のpurgeは引き続きdry-runのみで、保持期間・法的保留・監査の専用経路を別途実装するまで自動消去しない。

## オーナー追加

現在のオーナーがアカウント管理の操作メニューから利用可能な参加済みメンバーを選び、全権限付与と既存オーナーの維持を確認する。パスワードまたは連携済みGoogle/Microsoftの再認証を利用する。SSO復帰では開始時の本人・組織・対象を照合し、確認画面に戻す。追加ActionとDBは対象と現ownerを再検証する。

`add_organization_owner_atomic`が`owner_add`証明の本人・session・purpose・期限・未使用を検証し、証明消費・対象の昇格・追記専用監査を同一トランザクションで行う。監査保存が失敗すると全体をロールバックする。業務ロールとスタッフ紐付けを維持する。組織行ロックを既存の除名・脱退・移管・事業所削除・退会と共有し、並行操作を直列化する。通常のロールRPCでのowner変更拒否を維持し、membershipの直接INSERT/UPDATE/DELETEをsession clientから取り上げる。初期owner作成と招待参加は既存の認可付きRPCを使う。

追加はowner専権であり、新しい業務権限キーは追加しない。`accounts` / `ownerTransfer`権限を持つ非ownerにも許可しない。既存移管RPCの再認証・監査改善（AUTH-02 / AUDIT-01）は別課題とする。

## 外部仕様確認

2026-10-06、Context7でSupabase公式のDatabase Functions / RLSと、Next.js公式のServer Actions / 認可を確認した。Storybook公式のmodule mockも確認し、server-only Actionは型のみを参照する`__mocks__`で置換した。対象はリポジトリのStorybook 10.4.6、Next.js 16.3.6、supabase-js 2.108.2（package.jsonの宣言は^2.91.0）、PostgreSQL 17、Supabase CLI 2.108.0。Next.jsは同梱ドキュメントも参照し、既存バージョンからの移行は行っていない。

- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions): 空の`search_path`、明示的な関数実行権限。
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): 認可付きDB境界と直接DML権限。
- [Next.js Data Security](https://nextjs.org/docs/app/guides/data-security): Server Action内での認証・認可の再確認。

## 検証と反映

2026-10-06にtypecheck、lint（警告0）、build、unit 478件、Storybook browser 67件、DB 181件、DB lintを実行して成功した。開発DBとは別の使い捨てSupabaseで空DBからの再構築と既存migrationからの追加適用を確認した。2つの実トランザクションによる並行操作6ケースでも、重複追加・追加と除名・待機中のセッション失効・現owner除名・同時脱退を検証した。直接membership DMLを禁止しても、既存の招待参加・初期owner作成RPCは動作する。E2Eは専用環境とユーザー確認が必要なため実行していない。実際の外部OAuth・Google API接続はこの検証に含めず、テストではmockを使う。

反映時は`20261006000001_add_organization_owner.sql`と`20261006000002_retry_deleted_shift_google_sync.sql`を先に適用する。上記ローカル検証時点ではホスト環境に未適用。実際のリリース結果はPRの適用証跡を参照する。既存migrationは変更していない。

並行操作試験は`node scripts/db/test-owner-add-concurrency.mjs <専用DBコンテナ名>`で実行する。専用名`supabase_db_care-record-owner-add-test`または`supabase_db_care-record-issues-84-85-test`（任意の英数字suffixも可）以外は拒否する。fixtureをcommitするため、実行後は専用stackを破棄またはresetし、開発・共有環境には使用しない。
