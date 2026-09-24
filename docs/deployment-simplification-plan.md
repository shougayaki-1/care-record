# 個人開発向けデプロイ運用の整理計画

作成日: 2026-09-23
状態: [ドラフトPR #17](https://github.com/shougayaki-1/care-record/pull/17)で実装と検証を進めています。Productionの監視URL、VercelのPreviewフィルター、`main` の必須CI設定は完了しました。監視通知の到達確認とProduction配備は未完了です。

## 2026-09-24時点の実施状況

- PRの変更: アプリ配備用workflowと仮の `keep_alive.yml` を削除し、基本CI、条件付き検査、ローカルSupabase E2Eを `ci.yml` に統合しました。文書もこの運用に合わせて更新しました。PR #17はドラフトであり、リモートの `main` への配備を示すものではありません。
- ローカル検証: lint、型チェック、本番build、service roleの使用検査、unit 250件、UI 17件、CI判定対象のテスト10件が成功しました。依存関係を更新し、`npm ci` とHigh以上を失敗扱いにする依存監査も成功しました。監査にはModerateの指摘が5件残っています。全E2Eは更新前に20件成功しました。更新後は20件中18件が成功し、モバイルの遷移判定で失敗した2件を修正した後、該当ファイルの6件を再実行して成功しました。
- 外部サービスの状態: GitHub Actionsは有効で、Full logical backupとBackup freshnessの直近実行は成功しました。PR #17のApp、DB、UI、依存監査、secret scan、ローカルSupabase E2E、最終の `CI` check、Staging Previewは2026-09-24に成功しました。`main` のbranch protectionにはPR経由と `CI` 成功を必須に設定し、読み戻して確認しました。GitHubの外形監視にはHTTP確認と通知の失敗履歴があります。`HEALTHCHECK_URL` とVercel ProductionのPreviewフィルターは2026-09-23に設定し、読み戻して確認しましたが、Discord通知の到達は未確認です。
- 未完了: 外形監視のDiscord通知到達とProduction環境変数のscopeを確認し、本番配備後の検証を終えるまでは運用切替を完了扱いにしません。作業担当者はGitHubの既存 `Production` Environmentにsecret `DISCORD_ALERT_WEBHOOK_URL` を設定し、`care-record` VercelプロジェクトのProduction環境に `SUPABASE_SERVICE_ROLE_KEY` を設定してください。値は表示・転記せず、通知の到達を確認します。確認後、サービスオーナーの明示承認を得るまではPR #17をマージしたりProduction配備を開始したりしません。旧 `e2e` Environmentの削除は、そこに保存された6件のsecret値も消えるため、承認・実施ともに保留です。詳細な確認時点と結果は[deployment-runbook.md](deployment-runbook.md)を参照してください。

## 目的と到達点

個人で維持できるリリース手順にまとめ、日々の作業と重複検査を減らしながら、組織間のアクセス制御、本番データの分離、バックアップ、復旧能力を維持します。

- 通常の配備はVercel Git連携で行います。
- 基本の流れは `feature/* → PR → main` とし、常設の `staging` ブランチは必須にしません。
- ローカルと本番を基本にします。既存のStaging Supabase / Vercelは、データベース、認証などの確認に使います。環境を作り直したり、プロジェクトを統合したりせず、現在の分離構成を利用します。
- E2EではローカルSupabaseを使い、専用クラウドDBやその秘密情報への依存をなくします。
- 初回導入、通常リリース、定期保守、障害復旧の手順を分けます。

## 1. 実設定と稼働状況の確認

実装開始時に次の項目を読み取り、現在の設定、確認日、変更が必要な項目を記録します。

- GitHub Actionsが実行可能か、課金停止に関する記述が現在も正しいか、最近のCI・バックアップ・監視が成功しているか。
- `main` の保護ルールと必須チェック。単独開発者が運用できるPRと自己レビューの方式にします。
- 2つのVercelプロジェクトのGit接続、Production Branch、Ignored Build Step、Preview / Productionの環境変数scope、Deployment Protection。
- Productionは `main` のみ、確認用プロジェクトはfeatureブランチからPreviewを配備する構成。二重配備やPreviewへの本番資格情報の混入がないか。
- 最新の成功バックアップ、鮮度監視、障害通知の到達。無人の定期処理がEnvironmentの手動承認待ちにならないか。
- `staging` にしかない未統合commitと、廃止予定のE2E DBの用途。

Actionsが停止している場合は、先にCIと既存の定期処理を稼働できる状態にします。新たな課金が必要な場合は、費用と具体的な設定変更を示して判断します。定期バックアップが動作していない状態では切替を完了扱いにしません。

## 2. リリース経路の一本化

対象: `.github/workflows/deploy.yml`、Vercel / GitHubの設定、リリース手順。

1. PRの必須チェックとVercel Git配備が機能することを確認します。
2. `.github/workflows/deploy.yml` を削除します。通常配備と復旧にはVercelの既存機能を使います。
3. データベースを変更する場合は、対象Project ID、変更ファイル、候補SHA、dry-runを確認してから手動適用します。
4. データベース変更をStagingで確認し、本番バックアップを確認してからProduction DBへ適用します。適用時点の旧アプリでも動作することを確かめてから `main` にマージします。
5. columnの削除などは「追加して両対応 → アプリ切替 → 別リリースで旧構造を削除」の順に分けます。
6. Production配備後にhealth、ログイン、最小限の記録保存を確認します。認可を変更した場合は、他組織からのアクセスが拒否されることも確認します。
7. 直前の正常なDeploymentの識別方法、切り戻し手順、切り戻し後の確認方法を記載します。アプリを戻してもDBは戻らないこと、DB障害は別の復旧手順で扱うことを明記します。

候補SHA、必要なDB適用結果、配備URL、確認結果をPRに簡潔に記録します。専用の承認台帳や配備システムは追加しません。

## 3. CIとE2Eの整理

対象: `.github/workflows/ci.yml`、`playwright.yml`、`security.yml`、`playwright.config.ts`、`tests/`、必要なnpm scripts。

- コード変更の基本チェックはlint、型、単体テスト、本番build、service role使用検査とします。軽い検査は同じjobにまとめ、依存関係の重複インストールを減らします。
- DB変更では空DBの再構築、既存DBの更新、型生成差分、pgTAP / RLSの検査を維持します。認可コード、DBテスト、関連設定の変更でも必要な検査が起動するよう対象pathを定義します。
- E2EはローカルSupabaseの起動、migration、合成データ準備、テスト、環境破棄までを一連で実行します。本番URLへの接続を拒否するguardを設けます。
- ログイン、記録保存、組織分離を主要E2Eとし、アプリ変更時に実行します。その他のE2EとStorybook UI検査は、関連変更時または手動で実行します。検証範囲を確認せず既存テストを削除しません。
- 依存脆弱性検査は依存関係変更時と週次に実行し、secret scanはPRで維持します。SBOMは依存関係変更時または定期検査にまとめます。
- ドキュメントだけの変更では重いテストを起動しません。条件付きjobが省略されても必須チェックが待機し続けないよう、最終判定jobの名前を固定します。
- ローカルE2Eの成功と参照がなくなったことを確認してから、クラウドE2E用のEnvironment / Secretsを整理します。Supabaseプロジェクト自体の削除は用途確認後の別作業です。

## 4. 監視とバックアップの整理

対象: `keep_alive.yml`、`external-health.yml`、`full-backup.yml`、`backup-freshness.yml`、関連手順。

- `keep_alive.yml` は有効なhealth監視ではない仮のworkflowとして作業treeから削除済みです。`external-health.yml` は唯一の外形HTTP監視として残し、endpointと通知経路の成功を確認するまでは切替を完了扱いにしません。
- 既存の外形監視1系統を使います。通知が届くこととPreview保護の扱いを確認し、新しい監視基盤は増やしません。
- 完全DBバックアップと鮮度監視を維持します。日次・月次の業務exportは完全DBバックアップとは目的が異なるため、重複とみなして削除しません。
- 復元確認は毎回のアプリ配備から切り離します。初回、バックアップ方式の変更時、既存の定期保守で実施します。本計画では復元頻度、保存期間、RPO / RTOを変更しません。
- 不要になったSecretsは、すべての参照を確認してから整理します。バックアップ用の権限・OIDC・Environmentを、配備専用と誤認して削除しません。
- 旧 `e2e` GitHub EnvironmentにはクラウドE2E用secretが6件残っています。削除すると保存済みのsecret値も消えるため、削除は別途承認されるまで保留します。

## 5. ドキュメントの整合性修正

日常運用の入口はREADME、手順の正本はdeployment-runbookとします。同じ手順を複数の文書に重複して記載しません。

| ファイル | 修正内容 |
| --- | --- |
| `README.md` | feature → PR → main、Git配備、DB先行適用、参照先を簡潔に記載します。古いmigrationファイルへの案内とテンプレートの配備説明を整理します。 |
| `docs/deployment-runbook.md` | 初回設定、通常リリース、DB変更、アプリ切り戻しを具体化します。必要な変数名と設定場所を実装に合わせます。 |
| `docs/development.md` | stagingブランチが必須という前提、CI無効化などの古い記述、READMEの旧手順への参照を修正します。 |
| `docs/testing.md` | 変更別の検査、ローカルE2Eの実行方法と安全策、全件検査の実行方法を記載します。 |
| `docs/system-decisions.md` | 今回の運用判断と日付を記録し、環境構成、CI、配備経路を更新します。 |
| `docs/release-readiness-checklist.md` | 初回提供・重要変更のチェックと日常リリースの簡潔な確認項目を明確にします。詳細な手順はrunbookを参照します。 |
| `docs/implementation-gap-plan.md` | 過去時点の計画であることと、今回置き換える項目を明示します。古い記述を現行要件として読ませないようにします。 |
| `docs/compliance/operations-policy.md` | 個人開発での変更記録、自己レビュー、運用責任を明確にします。通常配備に実行不可能な複数人承認を要求しません。 |
| `docs/compliance/README.md`、`production-evidence-checklist.md`、`control-matrix.md` | 初回提供、定期保守、個々のリリースで必要な証跡を区別し、現行手順へリンクします。 |
| `docs/compliance/backup-restore-bcp.md`、`incident-response.md` | バックアップ・復旧とアプリ切り戻しの責任範囲を明確にし、現行runbookへの参照を整えます。 |
| `infra/terraform/backup/README.md`、`.env.example` | 維持する環境、GitHub refs、変数の用途を実設定に合わせます。 |

すべてのMarkdownを検索して旧経路への参照を確認します。過去の提案書や `docs/superpowers/` の履歴は、現行仕様へのリンクまたは履歴であることの表示で整理します。実施していない本番確認を「確認済み」と記載しません。また、開発運用の変更を理由に顧客向けの保存期間や契約上の約束を自動で書き換えません。

## 実施単位と完了条件

変更は次の3単位で順に検証し、各単位で関連する文書も更新します。

1. **配備経路・監視・手順書**: 実設定を確認してGit配備とPRチェックを整え、deploy / keep_aliveを廃止します。
2. **CI・ローカルE2E**: テストを移行して成功を確認し、条件付き実行と不要な資格情報を整理します。旧 `e2e` Environmentは、6件のsecret値が削除されるため、別途承認を得るまで削除しません。
3. **運用文書の横断整合性と切替確認**: 規程、チェックリスト、履歴参照を整理し、不一致を解消します。

完了確認:

- アプリだけの変更、DB / 認可変更、ドキュメントだけの変更で想定したCIが起動し、省略されたjobがmergeを妨げない。
- ローカルE2Eがクラウドの秘密情報なしで成功し、本番接続が拒否される。
- featureのPreviewと `main` の本番配備が意図したプロジェクト・DBに向く。
- DB変更の事前確認から配備、障害時の切り戻しまで手順を追える。
- 外形監視、通知、完全バックアップ、鮮度監視の成功を確認できる。
- 文書のリンク切れ、存在しないコマンドやmigration、旧deploy workflowやE2E Secretsへの現行手順からの参照が残っていない。
- 検証済み事項と外部設定の未確認事項を区別する。未確認項目が残っている場合は移行完了としない。

## 仕様確認

計画時にContext7でVercel Git連携、Production Branch、Previewの現行資料を確認しました。実装前にも、変更対象となるGitHub Actions、Supabase CLI、Vercelの仕様をContext7で確認し、バージョンと確認日を変更記録に残します。

- https://vercel.com/kb/guide/deploying-next-and-userbase-with-vercel
- https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel
- https://github.com/github/docs/blob/main/content/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets.md
- https://vercel.com/docs/environment-variables

## 外部設定の確認記録（2026-09-23〜24）

GitHub CLIとVercel CLIで読み取った結果です。以下は観測内容であり、移行完了の記録ではありません。

- GitHub Actionsは稼働中です。2026-09-22の完全DBバックアップと鮮度監視に成功履歴があります。READMEにある課金停止中という説明は、現在の状態と一致しません。
- 外形監視には連続した失敗履歴があります。run `35788093677` はHTTP 200判定と失敗通知の両方で失敗しましたが、HTTPコードが記録されておらず、原因は断定できません。現時点で `care-record.shoug.org/api/health` と `care-record.vercel.app/api/health` はHTTP 200です。`Production` Environmentで不足していた `HEALTHCHECK_URL` は `https://care-record.shoug.org` に設定し、読み戻して確認しました。`DISCORD_ALERT_WEBHOOK_URL` は同EnvironmentのSecrets一覧にありません。通知経路は未確認で、今回は通知を送っていません。
- 2026-09-23時点では `main` に通常のbranch protectionもrulesetもありませんでした。PR #17の `CI` 成功後、2026-09-24にbranch protectionを設定し、PR必須、`CI` 必須、承認者0人、adminにも適用、force pushと削除を禁止する設定を読み戻して確認しました。
- Vercelの `care-record` と `care-record-staging` はGitHubに接続済みです。両プロジェクトのProduction Branchは `main`、Node.jsは24.xです。
- StagingにはPreviewのみをbuildするIgnored Build Stepがあります。ProductionプロジェクトにはPreviewを省略する設定を追加し、APIで読み戻して確認しました。
- Productionプロジェクトの環境変数metadataには `SUPABASE_SERVICE_ROLE_KEY` のProduction scopeがありません。秘密値は表示・転記していません。現在の配備のhealthはHTTP 200であり、過去の監視失敗の原因とは断定できません。次の配備前に、この変数がProduction scopeに設定されていることを確認する必要があります。
- リモート `staging` に `main` 未統合のcommitはありません（ahead 0 / behind 5）。ブランチ自体は削除していません。
- 作業開始時のローカルHEADは `3cbae88`、リモート `main` は `a1da955` でした。差分はリポジトリガイドと過去の監査文書の追加でした。PR #17の作業ブランチには `a1da955` が取り込まれています。
