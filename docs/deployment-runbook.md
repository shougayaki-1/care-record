# デプロイ運用手順書

この文書はアプリケーションのリリース運用に関する正本です。個人で保守する場合の手順を示します。末尾に記載した外部サービスの設定には、未適用または未確認の項目があります。この文書を、リリースや運用切替が完了した証拠として扱わないでください。

## 目標とする構成

- `feature/*` ブランチは `main` から作成し、レビューしたPRを `main` にマージします。常設の `staging` ブランチは任意です。
- 既存のVercelプロジェクト `care-record`（Production）と `care-record-staging`（Preview）を維持します。目標は、`care-record` では `main` からProductionへ配備し、`care-record-staging` ではfeatureブランチからPreviewへ配備する構成です。
- StagingとProductionのSupabaseプロジェクトを分けます。ローカルE2Eで確認できないホスト済みAuth、Storage、外部連携の確認にはStagingプロジェクトを使い、合成データまたは匿名化データを使用します。
- アプリケーションの配備はVercel Git連携で行います。通常のリリースに手動のアプリ配備workflowは使いません。
- `full-backup.yml` と `backup-freshness.yml` は、バックアップと鮮度確認の別々の運用として維持します。`/api/health` のエンドポイントと通知経路が正常になった後も、外形監視を1系統維持します。バックアップとhealth確認は互いの代わりにはなりません。

Vercelでは、設定されたProduction BranchからProductionへ配備され、その他のブランチはPreviewへ配備できます。Productionプロジェクトのブランチを `main` に設定し、PreviewのビルドフィルターでfeatureブランチがStagingプロジェクトだけに配備されるようにします。[Vercel Git配備のドキュメント](https://vercel.com/docs/deployments/git)を参照してください。

## 初回設定と切替

1. GitHubで `main` のrulesetまたはbranch protectionを設定し、[testing.md](testing.md)に記載した固定名のCI判定を必須にします。単独の保守担当者は自己レビューとチェック成功後にマージできる設定とし、通常変更に2人目の人間によるレビューを必須にしません。
2. Vercelの設定を読み戻して確認します。`care-record` のProduction Branchは `main` とし、Previewフィルターではfeatureブランチを除外します。このPreviewスキップフィルターは2026-09-23に適用し、読み戻して確認済みです。`care-record-staging` はPreview専用フィルターを維持し、featureブランチからPreviewが作られることを確認します。Deployment Protectionと、PreviewがProductionの秘密情報やデータへアクセスできないことも確認します。
3. [.env.example](../.env.example)を変数名の参照先として、各Vercelプロジェクトの適切な環境スコープにアプリ変数を設定します。Supabaseの参照先と鍵は環境ごとに分けます。サーバー専用値に `NEXT_PUBLIC_` から始まる名前を使わないでください。[`care-record` の環境変数設定](https://vercel.com/shougayaki-1s-projects/care-record/settings/environment-variables)で、`SUPABASE_SERVICE_ROLE_KEY` を**Productionのみ**に設定してください。値はSupabase Dashboardの**本番プロジェクト**の Settings → API Keys で確認し、既存の本番Supabase URLと同じプロジェクトの鍵を使います。ヘルスエンドポイントがこの変数を必要とします。値はVercelの安全な入力欄で設定し、ログ、PR、文書、チャットへ表示・転記しないでください。確認時は変数名と環境スコープだけを読み戻します。変更は既存の配備には反映されず、次のProduction配備から有効になります。
4. バックアップと外形監視のworkflowでは、既存のGitHub Environmentを再利用します。workflowは小文字の `staging` と `production` を指定しますが、確認済みアカウントには `Production` という既存Environmentがあります。workflowの参照先がこの既存Environmentであることを確認してください。大文字・小文字だけが異なるEnvironmentを追加作成しないでください。

   [GitHubリポジトリのEnvironments設定](https://github.com/shougayaki-1/care-record/settings/environments)から既存の `Production` Environmentを開き、**Environment secrets → Add secret** で `DISCORD_ALERT_WEBHOOK_URL` を設定してください。workflowがこのEnvironmentを使うことを確認したうえで、値をGitHubの安全なsecret入力欄に登録します。値をログ、PR、文書、チャットへ表示・転記しないでください。読み戻す場合はsecretの登録有無とEnvironment名だけを確認し、secret値は表示しません。

   対応するEnvironmentに次のSecretsを設定します。

   - `BACKUP_DATABASE_URL`（Supavisor session pooler）
   - `DISCORD_ALERT_WEBHOOK_URL`
   - `VERCEL_AUTOMATION_BYPASS_SECRET`（Deployment Protectionがヘルス確認を妨げる場合のみ）

   次のEnvironment variablesを設定します。

   - `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `GCP_BACKUP_SERVICE_ACCOUNT`
   - `GCS_BACKUP_BUCKET` と `GCS_REPLICA_BUCKET`
   - `BACKUP_CONFIG_VERSION` と `BACKUP_KEY_ID`
   - 外形監視workflow用の `HEALTHCHECK_URL`

   各jobでの使用箇所は3つのworkflowファイルで確認します。クラウドE2E用のEnvironmentやE2E Supabase secretsは作成しないでください。E2EはローカルSupabaseを使います。

   `external-health.yml` は通常、5分ごとに実行されます。Environment secretを登録しただけでは通知の到達を確認したことになりません。安全な方法で通知を実際に発生させ、GitHub Actionsの実行結果とDiscordへの到達を確認してください。通常の成功実行だけでは失敗通知の経路を確認できません。通知が届かなければ原因を調べ、通知経路を確認できるまで切替を完了扱いにしないでください。secret値は実行ログや証跡に含めません。
5. バックアップmoduleのWorkload Identity Federationにある `github_refs` は完全なrefで設定します。現在のTerraform検証は、branchまたはtagの完全なrefを受け入れ、wildcard patternは受け入れません。定期・手動のバックアップworkflowは `main` から実行されるため、両環境のidentityで `refs/heads/main` を許可できます。GitHub Environmentの選択でStagingとProductionを分け、Productionは `main` に限定します。
6. 現在のバックアップ・復元の証跡を確認します。バックアップ方式が変わった場合、または証跡の更新時期に達した場合は[backup-restore-bcp.md](compliance/backup-restore-bcp.md)に従って復元リハーサルを繰り返します。鮮度アラートの経路を確認し、運用切替の完了を宣言する前に外形監視と通知を直します。完全データベースバックアップと鮮度監視を維持してください。旧 `keep_alive.yml` はリポジトリから削除済みであり、health monitorではありません。

この切替では、`DISCORD_ALERT_WEBHOOK_URL` の設定後に通知到達を確認し、サービスオーナーの明示承認を得るまでPR #17をマージしたりProduction配備を開始したりしないでください。`main` のbranch protectionにおける必須承認数0という設定は変更しません。今回必要な承認は、この切替とリリースに対する個別の承認です。

## 通常のアプリケーションリリース

1. 最新の `main` からfeatureブランチを作り、変更を加えてPRを作成します。
2. 差分全体を自己レビューします。CIの結論と対象Previewを確認します。ホスト済みAuthや外部連携の確認が必要な場合はStaging Supabaseプロジェクトを使い、Preview URLを記録します。
3. データベース変更がなければ、チェック成功後にPRをマージします。Vercel Git連携により、結果の `main` commitがProductionへ配備されます。今回の切替に関するPR #17とProduction配備は、上記の個別承認を得てから進めます。
4. `/api/health` を確認し、サインインして最小限のテスト記録を1件保存します。候補SHA、CI結果、配備URL、スモークチェック結果をPRに記録します。
5. リリースに失敗した場合は、以下のアプリケーション切り戻し手順を使い、対象となった配備と結果を記録します。

通常リリースでは、新たな復元訓練、法務レビュー、初回提供向けの全証跡確認は必要ありません。初回のサービス提供、重要なシステム変更、および定期実施の時期に行います。

## データベースのリリース

各migrationは、明示したSupabaseプロジェクトに対して手動で適用します。適用ごとに候補SHA、migrationファイル、対象プロジェクトを確認してください。以下のSupabase CLIバージョンはCIで固定しているバージョンと一致します。

1. 新しいmigrationファイルを追加します。共有データベースに適用済みのmigrationを編集または削除しないでください。現在のアプリと候補アプリの両方で動作する追加的な変更を優先します。
2. featureブランチから開始します。CLIをStagingプロジェクトに接続し、migration履歴を確認します。次のコマンドを実行する前に、Supabase Dashboardで `$STAGING_PROJECT_REF` がStagingプロジェクトのrefと一致することを確認します。

   ```sh
   npx --yes supabase@2.108.0 link --project-ref "$STAGING_PROJECT_REF"
   npx --yes supabase@2.108.0 migration list --linked
   npx --yes supabase@2.108.0 db push --linked --dry-run
   ```

   接続先のmigration履歴と適用待ちmigrationをPRと照合します。dry-runの結果がレビュー済みmigration一式と一致した場合に限り、Stagingへ適用します。

   ```sh
   npx --yes supabase@2.108.0 db push --linked
   ```

3. migrationがホスト済みAuth、Storage、外部連携を変更する場合は、Stagingを使うPreviewで確認します。結果をPRに記録します。
4. Productionに適用する前に、Supabase Dashboardで `$PRODUCTION_PROJECT_REF` がProductionプロジェクトのrefと一致することを確認します。直近の完全バックアップ成功と鮮度チェック合格を確認してから、Productionへ接続して状態を調べます。

   ```sh
   npx --yes supabase@2.108.0 link --project-ref "$PRODUCTION_PROJECT_REF"
   npx --yes supabase@2.108.0 migration list --linked
   npx --yes supabase@2.108.0 db push --linked --dry-run
   ```

   対象プロジェクト、履歴、dry-runがレビュー済みmigration一式と一致する場合に限り適用します。

   ```sh
   npx --yes supabase@2.108.0 db push --linked
   ```

   プロジェクトref、migration名、dry-run、バックアップ実行、適用結果をPRに記録します。いずれかの値が意図した対象と異なる場合は作業を中止します。
5. Productionのschemaが稼働中のアプリと互換であることを確認してからPRをマージします。Vercelはその後、`main` から新しいアプリを配備します。Productionへの変更を行う場合は、本件の個別承認を得てから進めます。
6. 古いcolumn、constraint、functionは、配備済みのすべてのアプリコードが使わなくなった後、別リリースで削除します。

Production DBの変更が稼働中アプリと安全に共存できない場合は作業を止め、expand、migrate、switch、contractの各段階に分けてリリースします。適用済みmigrationファイルを書き換えて取り消そうとしないでください。

## アプリケーションの切り戻しとデータベース復旧

アプリケーション配備に問題がある場合は、Vercelで直前の正常なProduction deploymentを開き、Vercelの配備操作を使って切り戻すか、そのdeploymentをpromoteします。その後、health、サインイン、最小限の記録保存を確認します。使用したdeploymentと結果をPRまたはインシデント記録に残します。

アプリケーションの切り戻しではデータベースは元に戻りません。migrationによってデータ損失または互換性のないschemaが発生した場合は、アプリ変更を止め、[backup-restore-bcp.md](compliance/backup-restore-bcp.md)に従ってください。データベースの復元は、対象、バックアップ世代、証跡記録を明示して行う別の復旧作業です。

## バックアップと監視の運用

- `full-backup.yml` はスケジュール実行され、手動実行では `staging` または `production` を指定できます。Production migrationの前に、直近の成功バックアップが承認済みの鮮度期間を超えている場合は手動実行します。
- `backup-freshness.yml` は完全バックアップと複製先の鮮度を1時間ごとに確認します。アプリケーション配備とは独立して通知経路を維持します。
- `external-health.yml` は個人情報を含まない `/api/health` エンドポイントを5分ごとに確認します。GitHub Environmentに `HEALTHCHECK_URL` と `DISCORD_ALERT_WEBHOOK_URL` が必要です。Deployment Protectionが確認を妨げる場合は、workflowがサポートする `VERCEL_AUTOMATION_BYPASS_SECRET` も設定します。workflowが失敗したらエンドポイントと通知経路を調査してください。GitHubの実行がgreenでも、本番機能がすべて正常である証拠にはなりません。
- 初回のサービス提供前と、その後は[backup-restore-bcp.md](compliance/backup-restore-bcp.md)で定めた周期で完全な復元リハーサルを実施します。世代、対象プロジェクト、実測したRPO/RTO、証跡を記録します。
- アプリケーションの日次業務exportは完全な論理データベースバックアップとは別の役割があります。両方を維持します。

## 読み取り専用の状況記録

外部設定は2026-09-23と2026-09-24に確認しました。以下は確認したアカウントの状態を示すもので、このbranchからProductionへ配備した証拠ではありません。

- GitHub Actionsは有効です。直近の完全論理バックアップとバックアップ鮮度確認は成功しました。
- 外形監視workflowには調査中の失敗履歴があります。run `35788093677` はHTTP 200確認と失敗通知の両方で失敗しましたが、HTTP statusはログに記録されていません。2026-09-23には公開health URLの両方がHTTP 200を返しました。その後、`HEALTHCHECK_URL` に `https://care-record.shoug.org` を設定し、既存の `Production` Environmentで読み戻して確認しました。`DISCORD_ALERT_WEBHOOK_URL` はそのEnvironmentのsecret一覧になく、通知経路は未確認です。
- PR #17は2026-09-24にApp、空DBとpgTAP、UI、依存監査、secret scan、ローカルSupabase E2E、最終 `CI` checkに合格しました。`care-record-staging` のPreviewはREADYになり、Vercel SSOが必要です。
- `main` のbranch protectionは2026-09-24に設定し、読み戻して確認しました。PRと `CI` checkを必須とし、単独の保守担当者のため必須承認数を0に設定し、adminにも適用します。force pushと削除は禁止しています。
- 旧 `e2e` GitHub Environmentには、クラウドE2E用secretが6件残っています（`E2E_SUPABASE_ANON_KEY`、`E2E_SUPABASE_SERVICE_ROLE_KEY`、`E2E_SUPABASE_URL`、`SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`SUPABASE_PROJECT_ID`）。置き換え後のCIがPRで成功し、参照するworkflowがないことを確認してから削除してください。Environmentを削除すると保存済みのsecret値も削除されます。置き換え後のCIは成功済みですが、この削除は未承認で、実行していません。
- 2つのVercelプロジェクトが存在します。StagingはPreviewをbuildします。ProductionプロジェクトでPreviewを省略するフィルターは2026-09-23に適用し、読み戻して確認しました。
- Production Vercelの変数一覧では、`SUPABASE_SERVICE_ROLE_KEY` がProduction scopeにありませんでした。現在配備中のhealth endpointはHTTP 200を返しているため、この不足が過去の監視失敗の原因とは断定できません。次の配備より前にProduction scopeへ設定してください。値は表示・転記せず、変数名とscopeだけを確認します。

実施担当者は、GitHubの既存 `Production` Environmentに `DISCORD_ALERT_WEBHOOK_URL` を設定し、`care-record` VercelプロジェクトのProduction scopeに `SUPABASE_SERVICE_ROLE_KEY` を設定してください。どちらの値も文書、PR、ログ、チャットへ出さないでください。その後、安全な方法で通知の実到達を確認します。通知確認後にサービスオーナーの明示承認を得るまで、PR #17をマージしたりProduction配備を開始したりしないでください。旧 `e2e` Environmentの削除は、6件のsecret値を消すため別途承認されるまで保留です。

## 仕様確認に使った資料

このrunbookの今回の更新にあたり、2026-09-24にContext7で最新の資料を確認しました。

- [Vercel Git配備](https://vercel.com/docs/deployments/git): Production Branchの動作と、その他のbranchからのPreview配備。
- [GitHub Environment secrets](https://github.com/github/docs/blob/main/content/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets.md): Environmentを指定したsecret設定方法。
- [GitHub Environmentsの管理](https://github.com/github/docs/blob/main/content/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments.md): workflowから存在しないEnvironmentを参照した場合の作成動作。
- [Vercel環境変数](https://vercel.com/docs/environment-variables): Production、Preview、Developmentなどの環境ごとの変数スコープ。
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys): 本番プロジェクトのservice role keyの確認場所と権限。
- [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction): local status、start/reset/stop、linked migration listing、`db push --dry-run` のsyntax。ProjectとCIはSupabase CLI 2.108.0を使用します。
- [GitHub Actions job conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions): 条件付きjobの省略と、固定名の最終status checkについて。
