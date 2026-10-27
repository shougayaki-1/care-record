# MCP現状棚卸しと後続設計の未決事項（#167）

調査日: 2026-10-27、追記: 2026-10-28。コード基点: `origin/main` `1dbd90ebe97c7b0120a8f166854fdb360fad1b12`。初回は静的調査と接続済みクライアントのツール定義を確認した。後日の稼働環境調査は以下に記載し、配備時のGit SHAとクライアントの実際の接続先は未確認。個人情報を含むツール実行は行っていない。#167は接続先と提供条件が確認できるまで未完了とする。

## 現行経路と公開契約

リポジトリの実装は `supabase/functions/care-record-mcp/index.ts`、共有フォームは `supabase/functions/_shared/default-form-template.json`。`supabase/config.toml` は当該関数のゲートウェイJWT検証を無効にし、関数内の `withOAuthProtectedResource` / `withSupabase({ auth: 'user' })` が認証を担当する。想定URLの形式と手順は [AI取込MCP](ai-import-mcp.md) にある。サーバー名は `care-record-import`、バージョンは `0.1.0`。実際の接続URL、環境、配備SHA、OAuth設定、運用責任者は未確認。

| ツール | 入力と結果 | 主体・データ・副作用 | 担当 |
|---|---|---|---|
| `list_workspaces` | 空入力、所属事業所のIDと名前 | OAuth本人。事業所名を返す。読取 | 既存、#168/#169で再評価 |
| `get_record_form` | 事業所UUID、フォーム・選択肢・本人のスタッフ名 | 本人の所属を確認。本人名を含む。読取 | 既存、#168/#169で再評価 |
| `submit_record_candidate` | 事業所UUID、任意のファイル名、記録候補、`send_anyway` | 本人・所属をRPCで検証。氏名・記録本文等を含み、確認待ち候補を作成。承認済み記録は作らない | 既存、#169/#170/#187で再評価 |

`submit_record_candidate` はコード上、不明点があり `send_anyway=false` の場合 `needs_clarification` と質問を返し、送信時は `submitted` と候補IDを返す。入力は氏名等255文字、担当者10人、警告30件等の制限を持ち、正規化後のpayloadは100000文字を超えると拒否する。結果は `structuredContent` とテキストに重複して含まれる。失敗時は日本語の汎用エラーを投げる。安定した機械可読エラーコードやページングは現行3ツールには定義されていない。詳細の正本は実装。

2026-10-27の接続済みクライアントの定義には3つの同名ツールがあるが、`submit_record_candidate` の `send_anyway` が見えず、質問・再送の説明もコードと異なる。接続先の古い配備、クライアント側の変換・キャッシュ等のいずれかは未判定。接続先のURLと配備SHA、認証後の `tools/list` を合成データ環境で照合するまで互換性を確定しない。過去のPR #26は2026-09-27の本番配備と未認証401・OAuth metadata 200の結果を報告している。ローカルCLIのリンク先はその記録の本番プロジェクトと一致するが、いずれも現在の接続先や稼働SHAの証拠ではない。

### 2026-10-28 の追加証跡

過去の本番配備記録が示す Supabase project `ougdmklcwargnmaphkdn` の `care-record-mcp` は ACTIVE、version 3。配備済み関数本体と同梱の共有ファイルを取得し、`origin/main` `b4bf9fd0cb94d006937548578e216517614bfbfd` の対応ファイルと一致することを確認した。未認証の関数URLは401と同projectのOAuth metadataを返した。配備ソースと現在のコードの一致は、配備時のGit SHAや、クライアントがこのURLを使っていることを証明しない。クライアントに `send_anyway` が見えなかった原因も未確定。

新しいチャットではステージングMCPの `list_workspaces` が合成データ用事業所を返し、公開スキーマに `send_anyway` がある。ステージングのSupabase Site URLは失敗済みPreviewを指していたため、稼働中の固定Previewに変更し、そのcallback・reauth-callback・recovery-callbackを許可URLに追加した。通常のCodex OAuth再認可は成功した。これは固定配備を使う暫定復旧であり、恒久URLとVercel SSOが他の利用者に与える影響は未確認。

#192の停止制御はmainに統合され、productionにmigration `20261027000001` が適用済み。新規候補送信は事業所ごとに既定offで、既存候補の確認・承認は維持する。管理者による提供条件の確認がない事業所では有効化しない。接続先と配備版の最終照合、提供条件の確認は引き続き必要。

OAuth `client_id` を持つトークンを `mcp_import` に分離する設計は `supabase/migrations/20260927000001_isolate_mcp_oauth.sql`、本人名RPCは `20260927000002_ai_sent_review.sql`。権限の期待値は `supabase/tests/mcp_role_security.sql`。Hookが実際に有効かは未確認。接続解除後も発行済みJWTが期限まで使える可能性は [運用文書](ai-import-mcp.md) に記載されており、#168で失効・退会・権限変更を実測する。

## 既存業務との接点

| 領域 | 現行コードの入口 | 共通化の判断 |
|---|---|---|
| シフト取得・作成・更新・取消 | `src/app/actions/shifts/crud.ts` | 業務規則と権限を調査し、MCP本人コンテキストでも安全に共有できる境界を #168/#172/#179〜#181 で設計。Server Actionをそのまま外部公開しない |
| 記録保存・状態遷移・閲覧監査 | `src/app/actions/reports.ts` | 版管理・権限・監査を維持。#174/#182/#183 で共通処理とRPCを検討 |
| スタッフ・利用者 | `src/app/actions/staffs.ts`, `src/app/actions/clients.ts` | 担当範囲と最小属性を #168/#169/#173 で確定。同名は明示選択を要する |
| Google同期 | `src/app/actions/shifts/googleSync.ts`, `googleSyncInternal.ts` | シフトを正本とし既存の障害時処理を #180/#181 で検証 |
| AI候補と承認 | `src/app/actions/aiCandidates.ts` | 候補と承認済み記録を分離。既存経路の提供条件を #169 で再評価 |
| 監査 | `src/utils/supabase/audit.ts` | 操作ごとの監査と失敗時の契約を #170/#171 で確定 |

上記は調査対象の入口であり、そのまま再利用可能と証明したものではない。RLSと `src/utils/permissions.ts` の対応、セッション・担当範囲・版・Google同期の整合を各Issueで検証する。

## 安全ゲートと後続契約

[システム方針](system-decisions.md) §9は、AI記録インポートを処理条件・保存地域・ログ保持・利用者説明の確認完了まで無効とする。既存MCP候補送信は `AI_IMPORT_ENABLED` に依存しないが、#192でDB側の事業所別既定off制御を追加した。提供条件の確認は未完了であり、新たな個人情報取扱いの提供判定はNo-Goとする。停止制御の詳細は [#169の設計](mcp-data-policy-169.md) と実装を参照する。

OAuth JWTの `mcp_import` ロールは `submit_mcp_candidate` の実行権限を持つため、Data APIからRPCを直接呼べる。Edge Functionだけを無効化しても候補登録を遮断できない。`AI_IMPORT_ENABLED` はNext.js側の設定で、Edge FunctionやDBへ自動的に共有されない。#169でDB側のfail-closed制御、既存候補の確認・承認の維持、組織別設定と変更時の監査を実装した。提供条件の実確認と復旧時の運用判断は残る。接続解除のみでは発行済みJWTを即時無効化できると仮定しない。

新規ツールの名前、入力・出力、最大期間・件数、ページング、エラー型、事業所単位の停止手段、運用責任者は未確定。#168/#169/#171 のゲート後、各機能Issueで以下を具体化する。

- 本人と事業所・担当範囲を毎回サーバー側で検証し、利用者指定IDを認可根拠にしない。候補が複数なら自動決定しない。
- 保存時刻UTCと業務日Asia/Tokyoを区別し、境界を試験する。検索は限定された期間・件数・安定した順序とページングを持つ。
- 読取と変更のツールを分離し、最小属性・機械可読エラー・クライアントの発見可能な説明を定める。0件と失敗を区別し、エラーに機微情報を含めない。
- 変更は提案、明示確認、権限と版の再検証、監査を #170 で設計する。既存3ツールの互換性と段階的停止・ロールバックを試験する。
- 個人情報の外部送信・新機能公開は、#169の提供条件判定と必要なレビュー、合成データによる否定試験の完了まで行わない。

## 未完了の証跡

1. 接続先環境・URL・配備SHA・OAuth Hook・実際の `tools/list` とクライアント差異を確認する。
2. データ処理契約、地域、保持、二次利用、説明と停止手段を確認し #169 で判定する。
3. 認証・失効・権限変更を #168、契約試験と運用監視を #171 で実測する。
4. オーナーと新契約の各上限、エラー・互換性を確定する。上記が未確認のため #167 の完了条件を満たしたとは扱わない。
