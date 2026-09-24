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
