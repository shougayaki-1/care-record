# MCP の契約試験と運用（Issue #171）

状態: 試験・運用の共通手順。各機能の公開状況と試験の結果は、対応 Issue・PR を正とする。本書をもって事業所の提供条件の確認や実データでの利用許可とは扱わない。提供前の判定は [system-decisions.md](system-decisions.md)、[MCPの提供条件](mcp-data-policy-169.md) を優先する。

## 現在の証跡と確認範囲（2026-11-23）

- 認証済み Staging MCP で合成事業所の一覧と本人の通知設定を取得済み。本番の「テスト用」事業所では、記録参照・変更・承認差戻し等を合成データで試験した。実施内容と片付けは各 Issue を参照する。実運用事業所の提供条件を確認したことにはならない。
- `mcp-contract.test.mjs` の6件は、確認器に対する合成 JSON/SSE 応答、契約差・エラー処理・秘匿などの回帰であり、業務ツールの正常系・認可拒否や配備後の実接続を証明しない。確認器本体は現行のツール名・入力と read/write 分類を検査する。
- 読取の正常・停止・認可境界は `mcp_shift_read.test.sql`（シフト・空き時間）、`mcp_person_search.test.sql`、`mcp_record_read.test.sql`、`mcp_billing_review.test.sql`、`mcp_kpi_source.test.sql` 等の合成 DB 試験で確認する。例として [PR #200](https://github.com/shougayaki-1/care-record/pull/200) と [PR #201](https://github.com/shougayaki-1/care-record/pull/201) は正常・別事業所・担当範囲・既定停止の結果、[PR #228](https://github.com/shougayaki-1/care-record/pull/228) は旧記録の承認キューと認可の結果を記録している。
- 変更の確認前・権限・競合・再送・監査は、`mcp_shift_create.test.sql`、`mcp_shift_update_*`、`mcp_shift_cancel_*`、`mcp_record_edit_*`、`mcp_report_transition.test.sql`、`mcp_shift_batch.test.sql`、`mcp_master_edit.test.sql` 等と各 PR の結果を参照する。[PR #216](https://github.com/shougayaki-1/care-record/pull/216)、[#217](https://github.com/shougayaki-1/care-record/pull/217)、[#223](https://github.com/shougayaki-1/care-record/pull/223)、[#224](https://github.com/shougayaki-1/care-record/pull/224) は検証層と未実施事項を記録している。実 Google 同期などは合成 DB の試験と区別する。
- 通知の配信・権限外や停止時の非配信・重複防止は `mcp_business_alerts.test.sql` と [PR #225](https://github.com/shougayaki-1/care-record/pull/225) を参照。[Actions 実行 44994142370](https://github.com/shougayaki-1/care-record/actions/runs/44994142370) の配信ステップは skipped で、実配信成功ではない。合成データ専用の接続先での Actions 実配信と運用開始は別途必要。
- [監視実行 45040498555](https://github.com/shougayaki-1/care-record/actions/runs/45040498555) は Production 成功、Staging は cancelled、Staging 検証は skipped。監視成功を Staging や MCP 業務機能の成功と読み替えない。MCP 固有監視の追加や全クライアント E2E は #166 の現行方針で本 Issue の必須条件ではない。

以下の導入時の説明には2026-10-29時点の状態を含む。配備版・実接続の最新結果に読み替えず、各 Issue と PR の新しい記録を優先する。

## 重複させない回帰試験

| 境界 | 既存／追加する検査 | 実行・未完了 |
| --- | --- | --- |
| 公開ツール名・入力・read/write分類 | `scripts/security/mcp-contract.test.mjs` と `check-mcp-contract.mjs` | 追加。JSON/SSE、`send_anyway`、環境制限、失敗・秘匿を合成応答で検査。実 SDK・配備は別途確認 |
| 値の正規化、日付・時刻、未知の項目 | `src/lib/ai/mcpCandidateValidation.test.ts` | 既存 unit。JSTの期間検索・ページングは未公開の後続機能で追加 |
| アプリとMCPのフォーム一致 | `src/lib/ai/mcpFormTemplate.test.ts` | 既存 unit |
| 最小DBロール・一般テーブル拒否・RPC allowlist | `supabase/tests/mcp_role_security.sql` | 既存 pgTAP |
| 事業所別停止・権限・監査失敗時のrollback | `supabase/tests/mcp_import_controls.test.sql`、`scripts/db/test-mcp-stop-concurrency.mjs` | 既存。停止競合の専用ローカル実行方法は同scriptのguardに従う |
| OAuth解除・本人期限・退会・ロール／担当変更と同時実行 | #168 の実装・試験 | ロール変更と利用者担当の変更を区別して証跡を残す。担当制の候補送信は拒否する |
| 確認・版競合・再送・監査／Google障害 | #170 と個別変更機能の契約試験 | 変更系ツールを公開する前に実装。既存画面の試験だけでMCPの保証としない |

`.github/workflows/ci.yml` の core は `node --test scripts/security/*.test.mjs` を実行するため、追加した確認器の回帰は既存jobで動く。`supabase/functions/` や認可実装の変更は現行の分類で core と DB を選び、unit・pgTAPを実行する。新しいworkflow、外部資格情報を使う自動試験、同じ境界を繰り返すE2Eは追加しない。CIの省略・失敗と実行結果は [testing.md](testing.md) に従って記録する。

## ステージングの実接続確認

1. 候補 SHA、ステージングの Supabase ref、Preview URL、配備関数の版、migration 履歴を照合する。固定 Preview の期限・SSO・OAuth転送先を確認する。#167 の本番接続先との差異は記録する。
2. 通常の OAuth フローで、合成データ専用事業所のテストアカウントを接続する。管理キーや通常アプリのセッショントークンを流用しない。
3. 通常フローで得たステージング専用アクセストークンを秘密値として `MCP_STAGING_ACCESS_TOKEN` 環境変数に設定済みのプロセスで、次を実行する。トークンをコマンド引数、履歴、CI artifact、PRへ貼らない。

   ```sh
   node scripts/security/check-mcp-contract.mjs
   ```

   確認器は固定のステージング endpoint にだけ接続し、`initialize`・初期化通知・`tools/list` を行う。業務ツールは呼ばず、事業所名・氏名・候補本文を取得しない。出力は合否と固定コードのみ。ツール契約が変わった場合、確認器の期待値を機械的に更新せず #167 の公開契約と照合する。JSON-RPC error、HTTP 401、通信失敗を成功としない。これは本人失効や業務認可の実行試験ではない。
4. 実MCPクライアントで合成事業所の一覧・フォームを確認する。候補送信を検証する場合は合成データ専用事業所だけを管理画面で有効化し、1件の合成候補と監査を確認する。停止後の新規送信拒否、既存候補保持も確認し、最後に off に戻す。#169 の既存証跡を再利用できる変更では試験を重複しない。
5. #168 の否定試験は専用OAuth接続だけを解除し、解除前の未期限トークンで業務RPCが拒否されることを確認する。`initialize` の成功だけで失効検証済みとしない。期限・退会・権限・別事業所の拒否を、実施した層（模擬DB／実Auth／実MCP）と分けて記録する。

## 段階提供と停止

提供条件未確認の事業所では新規候補送信を off のままにする。`AI_IMPORT_ENABLED=false` はMCP候補送信の停止スイッチではない。管理権限のある利用者が対象事業所へ切り替え、設定の「AIアプリからの記録送信」で停止する。DBの `disable_mcp_import` は有効セッションと連携管理権限を検証し、停止と監査を原子的に確定する。停止成功を読み戻し、同事業所の送信拒否を確認する。既存候補の閲覧・照合・承認・監査は保持する。

接続自体の解除はアカウント設定の「AIアプリとの接続」（`/app/ai-connections`）で対象AIを確認して実行する。#168 は接続解除後の未期限 JWT を RPC で拒否するが、最新の本人確認を含む実 OAuth 再接続は未検証。送信停止と併用し、実施環境ごとの拒否の証跡を残す。事業所別の送信停止は読取りや外部AIへ既に添付した原本の削除を制御しない。テナント越境や漏えいの疑いでは影響を受ける事業所を停止し、必要な接続を解除する。読み取りを含む環境全体の即時停止はまだアプリ内の共通スイッチがなく、運営者が基盤でアクセス遮断する手順・権限を提供前に実測する必要がある。

再開は原因解消、提供条件、権限、対象版と否定試験、停止・再開監査を確認してから少数事業所で行う。schemaの巻戻しで復旧しない。アプリ／関数の切り戻しとDBの互換性を [deployment-runbook.md](deployment-runbook.md) に従って確認し、#168 の拒否を弱める旧関数・旧RPCへ戻す場合は先に対象機能を停止する。

## 監視の確認先と残件

既存 [不審アクセス監視](security-monitoring.md) はログイン試行・Auth集計・監視自身の死活を扱う。MCPの業務認可拒否、ツールエラー率、成功不明の候補送信を集計する仕組みではない。`/api/health` の200もMCP・OAuth・候補送信の正常性を証明しない。MCPの運用者は配備の前後に Supabase Edge Function の HTTP/実行エラー、Auth の認可失敗、送信停止の監査 `integration.mcp_import.enable/disable` を確認し、時刻・環境・版・件数・対応を記録する。ログ保持期間と閲覧権限は環境ごとに確認する。

今回追加する `observeMcpTool` は、3ツールの実行完了ごとに `mcp.tool.completed`、固定ツール名、`success/error/needs_clarification`、単調時計によるミリ秒、呼出しごとの無作為な `trace_id` だけをJSONで出力する。入力、DB応答、候補・事業所・本人・OAuth client/sessionのID、例外の名前・本文・stackは出力しない。成功件数とerror件数から時間窓のエラー率を確認できるが、errorは認可拒否と基盤障害を区別せず、認証ミドルウェアでhandler到達前に拒否した呼出しも含まない。ログ配送は保証しない。ログ出力の失敗で確定済み候補を失敗表示しないよう、業務監査とは分離する。これは重要操作の監査を代替しない。

未完了: 認可拒否と異常なエラー率の自動検知／通知、配備先での構造化ログの実非露出と保持・配送の確認、読み取りを含む緊急停止の実測、#168/#170 の契約回帰。計測に本文・自由記述・ファイル名・氏名・トークン・URL query・生のDBエラーを含めない。外部ログサービスの導入は保持・地域を確認してから行う。現時点では #171 完了や本番提供可能とは判定しない。

PRの証跡には SHA、CI run、環境、migration、関数版、実施した合成試験と結果、実施しなかった試験、最終 off 状態を記す。秘密値や実記録は証跡へ複写しない。

仕様確認: 2026-10-29 Context7 `/modelcontextprotocol/modelcontextprotocol`。`tools/list` の object inputSchema、annotations がヒントであること、ツールエラーとプロトコルエラーの区別を確認した。確認器のプロトコル提案版は既存SDK互換の `2025-11-25` とし、外部資料だけを根拠に稼働SDKや公開仕様を移行しない。
