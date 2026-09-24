# 個人開発向けデプロイ運用の整理計画

作成日: 2026-09-23
状態: ローカル実装・一部検証済み。Production監視URLとVercel Preview filterは設定済み。CI必須設定、監視通知の成功、本番配備は未完了。

## 2026-09-23時点の実施状況

- ローカル変更: application deploy workflowとplaceholder `keep_alive.yml`を削除し、基本CI・条件付き検査・ローカルSupabase E2Eを`ci.yml`へ統合した。文書もこの運用に更新した。これらは現在の作業treeの内容であり、remote `main`への配備を示さない。
- ローカル検証: lint、型チェック、本番build、service role使用検査、unit 250件、UI 17件、CI判定範囲のテスト10件が成功した。依存関係を更新し、`npm ci`とHigh以上を失敗扱いにする依存監査も成功した。監査にはModerateの指摘が5件残る。全件E2Eは更新前に20件成功。更新後は20件中18件が成功し、モバイルの遷移判定で失敗した2件を修正して該当ファイルの6件を再実行し成功した。
- 外部状態: GitHub Actionsは有効で、Full logical backupとBackup freshnessの直近実行は成功した。GitHubの外形監視にはHTTP確認と通知が失敗した履歴がある。`HEALTHCHECK_URL`とVercelのProduction Preview filterは2026-09-23に設定・再読込したが、Discord通知成功は未確認である。`main`にbranch protection/rulesetはない。
- 未完了: 固定名`CI` checkを`main`で必須にし、外形監視のDiscord通知とProduction環境変数scopeを確認し、必要なworkflow成功記録を確認するまで運用切替完了とは扱わない。詳細な読み取り結果と時点は[deployment-runbook.md](deployment-runbook.md)を参照する。

## 目的と到達点

個人で維持できるリリース手順に統一する。日常の作業と重複検証を減らし、組織間のアクセス制御、本番データの分離、バックアップと復旧能力を維持する。

- 通常の配備は Vercel Git 連携に統一する。
- ブランチは `feature/* → PR → main` を基本とし、常設の `staging` ブランチを必須にしない。
- ローカルと本番を基本に、既存の Staging Supabase / Vercel は DB・認証等の確認用に使う。環境の作り直しやプロジェクト統合は行わず、現在の分離を利用する。
- E2E はローカル Supabase を使い、専用のクラウド DB とその秘密情報への依存をなくす。
- 初回導入、通常リリース、定期保守、障害復旧の手順を混在させない。

## 1. 実設定と稼働状況の確認

実装開始時に以下を読み取り、現在の設定・確認日・変更が必要な項目を記録する。

- GitHub Actions の実行可否、課金停止の記述が現在も正しいか、最近の CI・バックアップ・監視の成功履歴。
- main の保護ルールと必須チェック。単独開発者が運用できる PR / 自己レビュー方式とする。
- Vercel 2 プロジェクトの Git 接続、Production Branch、Ignored Build Step、Preview / Production の環境変数スコープ、Deployment Protection。
- 本番は main のみ、確認用プロジェクトは feature ブランチの Preview を配備する構成。二重配備や本番資格情報の Preview への混入を確認する。
- バックアップの最新成功世代、鮮度監視、障害通知の到達。無人の定期処理が Environment の手動承認待ちにならないかも確認する。
- `staging` にしかない未統合コミットと、廃止予定の E2E DB の用途。

Actions が停止している場合は、CI と既存の定期処理が稼働できる状態を先に確保する。新規課金等が必要な場合は、費用と具体的な設定変更を提示して判断する。定期バックアップが動かない状態で切替完了とはしない。

## 2. リリース経路の一本化

対象: `.github/workflows/deploy.yml`、Vercel / GitHub の設定、リリース手順。

1. PR の必須チェックと Vercel Git 配備が機能することを確認する。
2. `.github/workflows/deploy.yml` を削除する。通常配備と復旧は Vercel の既存機能を使う。
3. DB 変更は、対象 Project ID・変更ファイル・候補 SHA・dry-run を確認して手動適用する。
4. DB 変更を Staging で確認し、本番バックアップを確認してから本番 DB に適用する。適用時点の旧アプリでも動くことを条件に、main へ merge する。
5. 列削除等は「追加・両対応 → アプリ切替 → 別リリースで旧構造削除」に分ける。
6. 本番配備後は health、ログイン、最小の記録保存を確認する。認可変更時は他組織アクセス拒否も確認する。
7. 前の正常な Deployment の識別方法、切り戻し操作、切り戻し後の確認を記載する。アプリの切り戻しでは DB が戻らないこと、DB 障害は別の復旧手順で扱うことを明示する。

PR に候補 SHA、必要な DB 適用結果、配備 URL、確認結果を短く残す。専用の承認台帳や配備システムは追加しない。

## 3. CI と E2E の整理

対象: `.github/workflows/ci.yml`、`playwright.yml`、`security.yml`、`playwright.config.ts`、`tests/`、必要な npm scripts。

- コード変更の基本チェックは lint・型・単体・production build・service role 使用検査。軽いチェックは同一ジョブにまとめ、依存インストールの重複を減らす。
- DB 変更時は空 DB 再構築・既存 DB 更新・型生成差分・pgTAP / RLS を維持する。認可コードや DB テスト、関連設定の変更でも必要な検査が起動するよう対象パスを定義する。
- E2E はローカル Supabase の起動、マイグレーション、合成データ準備、テスト、破棄まで閉じた構成にする。本番 URL を拒否するガードを付ける。
- ログイン、記録保存、組織分離を主要 E2E とし、アプリ変更時に実行する。残りの E2E と Storybook UI 検査は関連変更時または手動実行にする。既存テストは検証範囲を確認せず削除しない。
- 依存脆弱性検査は依存関係変更時と週次、secret scan は PR で維持する。SBOM は依存関係変更時・定期検査にまとめる。
- ドキュメントだけの変更で重量級テストを起動しない。条件付きジョブの省略で必須チェックが待機し続けないよう、最終判定ジョブを固定名にする。
- ローカル E2E の成功と参照の解消後、クラウド E2E 用の Environment / Secrets を整理する。Supabase プロジェクト自体の削除は用途確認後の別作業とする。

## 4. 監視とバックアップの整理

対象: `keep_alive.yml`、`external-health.yml`、`full-backup.yml`、`backup-freshness.yml`、関連手順。

- `keep_alive.yml` は有効なhealth監視ではないplaceholderとして作業treeから削除済み。`external-health.yml`を唯一の外形HTTP監視として残し、endpointと通知経路の成功を確認するまでは切替完了と扱わない。
- 外形監視は既存の1系統を利用する。通知の疎通と Preview 保護の扱いを整え、新しい監視基盤を増やさない。
- 完全 DB バックアップと鮮度監視は残す。日次・月次の業務エクスポートは完全 DB バックアップと用途が異なるため、重複扱いで削除しない。
- 復元確認は毎回のアプリ配備から切り離す。初回・バックアップ方式変更時と既存の定期保守の手順に配置する。復元頻度、保存期間、RPO / RTO の変更は本計画では行わない。
- 不要になった Secrets は全参照を確認して整理する。バックアップ用の権限・OIDC・Environment を配備専用と誤認して削除しない。

## 5. ドキュメントの整合性修正

日常運用の入口は README、手順の正本は deployment-runbook とする。同じ手順を各文書に複製しない。

| ファイル | 修正内容 |
| --- | --- |
| `README.md` | feature → PR → main、Git 配備、DB 先行適用、参照先を簡潔に記載。古い migration ファイルへの案内とテンプレートの配備説明を整理 |
| `docs/deployment-runbook.md` | 初回設定、通常リリース、DB 変更時、アプリ切り戻しを具体化。必要な変数名と設定場所を実装に一致させる |
| `docs/development.md` | staging ブランチ必須の前提、CI 無効化等の古い記述、README の旧手順参照を修正 |
| `docs/testing.md` | 変更別の検査、ローカル E2E の実行方法と安全ガード、全件検査の実行方法を記載 |
| `docs/system-decisions.md` | 今回の運用判断と日付を記録。環境構成、CI、配備経路を更新 |
| `docs/release-readiness-checklist.md` | 初回提供・重要変更のチェックと日常リリースの小さな確認項目を明確化。詳細手順は runbook へ参照 |
| `docs/implementation-gap-plan.md` | 過去時点の計画であることと今回置き換える項目を明示。古い記述を現行要件として読ませない |
| `docs/compliance/operations-policy.md` | 個人開発での変更記録・自己レビューと運用責任を明示。通常配備に実行不可能な複数人承認を要求しない |
| `docs/compliance/README.md`、`production-evidence-checklist.md`、`control-matrix.md` | 初回提供・定期保守・個々のリリースで必要な証跡を区別し、現行手順にリンク |
| `docs/compliance/backup-restore-bcp.md`、`incident-response.md` | バックアップ・復旧とアプリ切り戻しの責任範囲、現行 runbook への参照を整える |
| `infra/terraform/backup/README.md`、`.env.example` | 残す環境、GitHub refs、変数の用途を実際の設定に合わせる |

全 Markdown を検索して旧経路への参照を確認する。過去の提案書や `docs/superpowers/` の履歴は現行仕様へのリンク・履歴の表示で整理する。実施していない本番確認を「確認済み」にせず、顧客向けの保存期間・契約上の約束は今回の開発運用変更から自動的に書き換えない。

## 実施単位と完了条件

変更は次の3単位で順番に検証する。各単位で対応する文書も同時に更新する。

1. **配備経路・監視・手順書**: 実設定の確認後、Git 配備と PR チェックを整え、deploy / keep_alive を廃止する。
2. **CI・ローカル E2E**: テストを移行して成功を確認し、条件付き実行と不要資格情報を整理する。
3. **運用文書の横断整合性と切替確認**: 規程・チェックリスト・履歴参照を整理し、残った不一致を解消する。

完了確認:

- アプリだけの変更、DB / 認可変更、ドキュメントだけの変更で意図した CI が起動し、省略されたジョブが merge を妨げない。
- ローカル E2E がクラウドの秘密情報なしで成功し、本番接続が拒否される。
- feature の Preview と main の本番配備が意図したプロジェクト・DB に向く。
- DB 変更の事前確認から配備・障害時切り戻しまで手順を追える。
- 外形監視、通知、完全バックアップ、鮮度監視の成功を確認できる。
- 文書のリンク切れ、存在しないコマンド・migration、旧 deploy workflow や E2E Secrets への現行手順からの参照が残っていない。
- 検証済みの事項と、外部設定未確認の事項が区別されている。未確認項目を残した場合は移行完了としない。

## 仕様確認

計画時に Context7 で Vercel Git 連携・Production Branch・Preview の現行資料を確認した。実装前にも変更対象の GitHub Actions、Supabase CLI、Vercel の仕様を Context7 で確認し、バージョンと確認日を変更記録へ残す。

- https://vercel.com/kb/guide/deploying-next-and-userbase-with-vercel
- https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel

## 外部設定の確認記録（2026-09-23）

GitHub CLI と Vercel CLI による読み取り結果。以下は観測結果であり、移行完了の記録ではない。

- GitHub Actions は稼働中。2026-09-22 の完全 DB バックアップと鮮度監視に成功履歴があり、README の課金停止中という説明は現状と一致しない。
- 外形監視には連続した失敗履歴がある。run `35788093677` は HTTP 200 判定と失敗通知の両方で失敗していたが、HTTP コードが記録されておらず原因は断定できない。現時点の `care-record.shoug.org/api/health` と `care-record.vercel.app/api/health` は HTTP 200。`Production` Environment に欠けていた `HEALTHCHECK_URL` は `https://care-record.shoug.org` に設定し、読み戻して確認した。`DISCORD_ALERT_WEBHOOK_URL` は同 Environment のSecrets一覧に存在せず、通知経路は未検証。今回は通知を送信していない。
- main に通常の branch protection も ruleset も設定されていない。新しい `CI` チェックがリモートで成功した後、必須チェックに設定する必要がある。
- Vercel の `care-record` と `care-record-staging` は GitHub 接続済みで、Production Branch は両方 main、Node.js は 24.x。
- Staging は Preview のみ build する Ignored Build Step がある。本番プロジェクトには Preview を省略する設定を追加し、APIで読み戻して確認した。
- 本番プロジェクトの環境変数メタデータに `SUPABASE_SERVICE_ROLE_KEY` の Production スコープがない。秘密値は表示・転記していない。現在の配備の health は HTTP 200 であり、過去の監視失敗の原因とは断定しない。次の配備前に必要な環境変数の Production スコープを確認する必要がある。
- リモート staging に main 未統合のコミットはない（ahead 0 / behind 5）。ブランチ自体は削除していない。
- 作業開始時のローカル HEAD は `3cbae88`、リモート main は `a1da955`。差分はリポジトリガイドと過去の監査文書の追加。公開前に最新 main と統合し、検証結果を確認する。
