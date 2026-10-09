# バックアップ基盤

このモジュールは、東京（`asia-northeast1`）と大阪（`asia-northeast2`）にそれぞれバックアップ用バケット、10年間保管する監査ログ用WORMバケット、Storage Transferによる日次複製、GitHub ActionsのWorkload Identity Federationを構成します。サービスアカウント鍵は作成しません。

`staging`と`production`では、Terraformのstateとバックアップ用リソースを分けて管理してください。`staging`環境はバックアップワークフローが使うGitHub Environmentであり、`staging`ブランチを常設する必要はありません。

1. GCPプロジェクトごとに、専用のGCS stateバケットを1つ用意します。バケット単位の均一なアクセス制御、パブリックアクセス防止、オブジェクトのバージョン管理を有効にしてください。stateバケットではBucket Lockを有効にしないでください。
2. 環境ごとのリモートstateを初期化します。例:

   ```sh
   terraform init \
     -backend-config="bucket=care-record-tfstate-PROJECT_NUMBER" \
     -backend-config="prefix=backup/staging"
   ```

3. `terraform.tfvars.example`を、Gitの追跡対象外となる環境別のtfvarsファイルへコピーし、すべてのプレースホルダーを置き換えます。`github_refs`はGit参照名の完全一致による許可リストです。このモジュールが受け付けるのはブランチまたはタグの完全な参照名であり、ワイルドカードは使えません。定期バックアップワークフローは`main`から実行されます。`staging`または`Production`の手動実行では、ワークフローの入力からGitHub Environmentを選びます。`main`から起動する場合は、両環境で`refs/heads/main`を許可してください。マージ前のテストで別のブランチが必要な場合は、その参照名だけを一時的に許可し、変更のマージ後に削除してください。`Production`では`refs/heads/main`だけを許可してください。
4. `terraform validate`を実行し、`terraform plan -out=backup.tfplan`でplanを保存します。
5. `workload_identity_provider`、`backup_service_account`、`backup_bucket`の各出力値を、対応するGitHub Environmentの変数に設定します。バックアップワークフローはこれらの値をGitHubから読み込み、アプリケーションの`.env.local`やVercelの実行時認証情報は使いません。
6. 保持設定と保存済みplanについて別途承認を得るまで、`enable_bucket_lock = false`のままにしてください。GCSで一度`true`にすると元に戻せません。

転送ジョブは新しい不変オブジェクトを毎日コピーし、削除は複製先へ反映しません。26時間の複製データ鮮度アラートでは、削除が同期されることを期待せず、両バケットの最新オブジェクトを比較してください。

## 世代管理（Issue #64）

取得は引き続きUTC `00:17 / 12:17`、12時間ごとです。RPOは14時間、複製鮮度は26時間を維持します。`enable_tiered_backups = true`で以下の4区分×東京・大阪の8バケットを**追加**します。既存primary / replicaの名前、retention、Storage Transferは維持し、既存世代をコピー・削除・保持短縮しません。primary / replicaと新規バケットは`prevent_destroy`で置換・削除を拒否します。監査バケットの10年WORMは変更しません。

| 区分 | 代表世代（日本時間） | 最低保持・Lifecycle Delete | ストレージ |
| --- | --- | --- | --- |
| recent | 定期12時間ごとと手動取得のすべて | 2日（直近24時間を確保） | Standard |
| daily | 各日の最初の定期成功 | 8日 | Standard |
| weekly | 日曜の最初の定期成功 | 32日 | Standard |
| monthly | 1日の最初の定期成功 | `backup_retention_days`、最低2555日 | 90日後にArchive |

各区分を別バケットにすることで、短期の削減と月次の7年保持をbucket-level retentionで両立します。例: `full/production/weekly/2026/11/01/care-record-production-2026-11-01.tar.gz`。recentのファイル名だけは取得開始時のUTC timestampを使います。同一アーカイブを選択された区分へ作成時に保存し、後から昇格しません。日曜と1日が重なれば同じ内容をdaily / weekly / monthlyへ保存します。1つ目の定期成功が代表となり、同日の2つ目の実行や再実行では`--if-generation-match=0`により既存代表を維持します。再試行の日付は最初の試行開始時に固定します。手動実行はrecentだけに保存し、代表を増やしません。代表日に全定期試行が失敗した場合は復元点が欠落するため、既存の失敗通知から再発防止・隔離環境での復元確認を行ってください。

新規バケットはversioningを無効、soft deleteを0にします。期限後の非現行世代・soft deleteによる長期残存を避けるためです。保存者にはobjectCreator / objectViewerのみを与え、上書き・削除を許可しません。`enable_tier_bucket_lock`は既存の`enable_bucket_lock`とは分離し、初期値falseです。新規区分のretentionを不可逆にロックする前に別途saved planを承認してください。falseの状態は管理者による変更不能を保証するものではありません。

本体と`.sha256`には同じbucket retention / lifecycleが適用されます。checksumはそのURIの本体から作り、本体だけ保存された試行は次回に補完します。不整合があれば上書きせず失敗します。GCSのオブジェクト作成・Lifecycle処理・複製は2ファイルの原子操作ではないため、一時的な片方だけの状態は発生し得ます。鮮度監視はペアが揃った世代だけを成功とみなし、復元も外部checksumと内部manifestを検証します。期限付近の両ファイルの消去時刻が完全同時であることは保証しません。

各区分を日次で大阪へ独立複製し、source削除・sink固有オブジェクト削除・上書きをすべて無効にします。大阪も同じ保持日数で独立してLifecycleを実行するため、東京での削除を同期しません。複製遅延分だけ大阪の期限は後になります。recentの2日保持は日次転送を待てるように設定しています。freshnessはrecentだけを検索し、完全なペアの**取得開始timestamp**を判定します。転送時刻や古い月次世代のコピーで鮮度を更新しません。

## 安全な移行

1. Production / StagingそれぞれのProject ID、既存の`backup_bucket` / `replica_bucket`をstateと運用設定から確認します。`gcloud storage buckets describe gs://BUCKET --format=json`でretention period、`isLocked`、versioning、soft delete、IAMを記録してください。2026-10-07に既存backendから`care-record-482716`を特定し、production / stagingのprimary / replicaが2555日、Bucket Lock未設定であることを読み取り確認しました（既定gcloud Projectは別Projectでした）。primaryはversioning有効、soft deleteは7日でした。適用直前にも対象を明示して再確認してください。
2. 既存stateを正しいbackendで読み込み、**既存変数の値を維持**して`enable_tiered_backups = true`のsaved planを作成します。既存バケットのdestroy / replace / retention短縮が出た場合は適用せず、Project、prefix、state、変数を修正します。既存stateを新規stateとして再作成しないでください。ロック済み・未ロックのどちらも既存保持を変えない方式です。
3. saved planのJSONで、既存primary / replica / auditにdelete actionがないことを確認して承認を得ます。Stagingで新規バケット・IAM・転送だけを適用し、Productionも同じ順序で実施します。このIssueのローカル実装ではapplyを実行しません。
4. `tier_backup_buckets` / `tier_replica_buckets`の出力から、各GitHub Environmentに以下の変数を追加します。`GCS_BACKUP_BUCKET` / `GCS_REPLICA_BUCKET`はlegacy値のまま残します。

   ```text
   GCS_RECENT_BACKUP_BUCKET / GCS_RECENT_REPLICA_BUCKET
   GCS_DAILY_BACKUP_BUCKET / GCS_DAILY_REPLICA_BUCKET
   GCS_WEEKLY_BACKUP_BUCKET / GCS_WEEKLY_REPLICA_BUCKET
   GCS_MONTHLY_BACKUP_BUCKET / GCS_MONTHLY_REPLICA_BUCKET
   ```

5. 新規IAMとStorage Transferが有効になった後、同じEnvironmentの`GCS_TIERED_BACKUP_ENABLED=true`を設定します。未設定・falseなら従来経路を継続し、trueで必須バケットが不足していればDB取得前に失敗します。切り替え初回のmanualはrecentのみです。定期実行でdailyを確認し、日曜・1日の代表作成も実績で確認してください。移行直後は過去7日・31日・月次の新規世代がまだないため、legacy世代も復元候補として維持します。
6. 東京の全区分の本体・checksumを確認し、日次転送後に大阪のペア・件数・hashを照合します。freshnessと隔離復元をStagingで成功させてからProductionを切り替えます。legacyバケットは復元用として残し、通常ワークフローからの新規書込みを停止します。旧primaryの書込IAMはロールバック用に維持します。アプリのCSVエクスポート／画像複製は本Issueの区分バケットへ移しません。
7. ロールバックは`GCS_TIERED_BACKUP_ENABLED=false`に戻してlegacy書込権限を復旧します。**`enable_tiered_backups=false`へ戻してバケットを削除しません**。新規世代・ロック済みlegacy世代は保持期限まで残します。既存データの一括削除や移し替えはありません。

## 一覧・復元・検証

`getLastBackupRun` / `listDailyBackups` / `getBackupRecords`と`/app/backup`は事業所別の即時検索用CSVとcron監査を扱い、全組織を含む完全DBアーカイブの閲覧経路ではありません。本Issueではその組織認可・CSV経路を維持します。完全DBバックアップはGitHubのreceiptとGCSから選択します。

```sh
gcloud storage ls --recursive gs://TIER_BUCKET/full/production/**
# legacy / 新しい全区分 / 大阪のいずれのURIも同じ復元スクリプトへ渡せます。
# 隔離DBと外部送信無効の必須環境変数は既存BCP手順で用意します。
scripts/backup/restore-logical-backup.sh gs://TIER_BUCKET/full/production/monthly/YYYY/MM/DD/care-record-production-YYYY-MM-DD.tar.gz
```

```sh
node --test scripts/backup/*.test.mjs
terraform fmt -check
# Use fresh local plugin/backend metadata; do not reuse an initialized live backend.
export TF_DATA_DIR="$(mktemp -d)"
terraform init -backend=false
terraform validate
terraform test
```

Terraformのmock providerによるplanテストは既存バケット属性の維持・区分別保持・転送・無効時を検査します。実stateに対するdestroy不在の証跡には、別途各環境のsaved planが必要です。Context7で2026-10-07にGoogle providerのbucket retention / Bucket Lock / lifecycle / versioning / soft delete仕様を確認（本モジュールの固定providerは7.40.0）しました。

### 読み取りplanの確認記録（2026-10-07）

`care-record-482716`の環境別リモートstateを権限制限された一時ディレクトリへコピーし、ローカルbackendで`-lock=false`のrefresh付きsaved planを作成しました。既存変数はstateの値を維持し、`enable_tiered_backups=true` / `enable_tier_bucket_lock=false`を指定しています。Google providerはlockfileの7.40.0、Terraformは1.15.8です。リモートstateへの書込み、実バケットの変更、applyは実行していません。

| 環境 | 追加 | 更新 | 削除・置換 | 既存primary / replica / audit |
| --- | --- | --- | --- | --- |
| Staging | 44リソース | 0 | 0 | すべてno-op |
| Production | 44リソース | 0 | 0 | すべてno-op |

追加は8バケット・4転送ジョブ・32 IAM grantです。これは上記日時の確認結果であり、適用時には各環境のbackendとsaved planを再確認します。新規区分への実転送・復元・切り替えの運用証跡は、基盤適用後に記録してください。
