# Issue #103 大阪recent複製の確認記録

確認日: 2026-10-24。対象: `care-record-482716`、PR #104。
状態: 本番read-only照合、承認済みplanのStaging / Production適用と実設定の確認済み。適用後の定期転送・ペア・鮮度検査待ち。

## 原因の照合

ProductionのGitHub Environmentは`GCS_TIERED_BACKUP_ENABLED=true`で、recentの東京・大阪バケットを参照している。実ジョブ`transferJobs/11102469581138403708`はENABLED、開始予定18:00 UTC、間隔86400秒だった。

- recentの取得可能な全18 operation（10/7初回から10/23まで）はSUCCESS。10/19は18:00:00.669 UTC開始、18:00:23.082 UTC終了、2オブジェクトをコピーした。
- [10/19夕方の完全バックアップ](https://github.com/shougayaki-1/care-record/actions/runs/39304917139)は18:43:34–18:45:49 UTCに実行された。取得開始timestampは`20261019T184408Z`で、その日の転送終了後だった。
- その前の[10/19朝の完全バックアップ](https://github.com/shougayaki-1/care-record/actions/runs/39200902215)の取得開始timestampは`20261019T044358Z`。
- [10/20 12:11 UTCの監視](https://github.com/shougayaki-1/care-record/actions/runs/39420414477)と[17:31 UTCの監視](https://github.com/shougayaki-1/care-record/actions/runs/39466788750)は認証・gcloud準備後の鮮度検査で失敗した。朝の世代からそれぞれ約31時間28分・36時間47分経過している。
- 10/20の転送は18:02:59.853–18:03:21.565 UTCにSUCCESS、6オブジェクトをコピーした。[20:52 UTCの監視](https://github.com/shougayaki-1/care-record/actions/runs/39495734865)以降、10/24 09:47 UTCまで取得した直近20回はsuccess。

以上から、少なくともこの再発期間では転送operation失敗ではなく、日次転送の終了後に完成したバックアップが翌日まで待つ時刻不整合が確認できる。期限超過自体は実在し、26時間基準を緩めて解消するものではない。過去のrecentオブジェクトは2日保持のため既に存在せず、当時の全ペア・ハッシュを再検証したとは扱わない。

## 現在のペアと他区分

対象バケットは`care-record-production-aea9b2b8-recent-{tokyo,osaka}`。
確認時の東京の最新完全ペアは取得開始`20261024T044012Z`、大阪は`20261023T171110Z`。東京の新世代は当日の18:00 UTC転送を待っている。

最新共通アーカイブは`full/production/recent/2026/10/24/care-record-production-20261023T171110Z.tar.gz`。

| メタデータ | 東京 | 大阪 |
| --- | --- | --- |
| 本体generation | 1792775537704035 | 1792778600101609 |
| 作成時刻 UTC | 10/23 17:12:17 | 10/23 18:03:20 |
| 本体size | 3,617,612 bytes | 3,617,612 bytes |
| 本体CRC32C | 一致 | 一致 |
| `.sha256` sidecar | 存在・内容一致 | 存在・内容一致 |

本体は読まずメタデータのみ照合した。sidecarの内容はメモリ内で比較し、値を表示・保存していない。Productionのdaily/weekly/monthly各17 operation、legacy直近20 operationもすべてSUCCESSだった。この確認は全履歴・全世代の完全性を保証するものではない。

## 適用前のsaved plan

Terraform 1.15.8、Google provider 7.40.0、基点`origin/main @ 1354bdf974739264b29b5718bf9e7e51146dcef4`。
既存stateから変数を復元して保持・名前・OIDC参照を維持した。初期のローカルコピーによるplanに加え、正しいGCS backend `care-record-tfstate-868574913206` の`backup/staging` / `backup/production`からrefresh付きsaved planを作成した。`-lock=false`でread-only調査し、apply・remote state更新は行っていない。

ADCの既定quota projectではGCS backend読取りが課金先エラーになったため、プロセス限定で`GOOGLE_CLOUD_QUOTA_PROJECT=care-record-482716`を指定して成功した。既存の認証・課金設定は変更していない。

| 環境 | 追加 | 更新 | 削除・置換 | saved plan SHA-256 |
| --- | --- | --- | --- | --- |
| staging | 0 | 1 | 0 | `4d4508d654b6f3672de1be56a700dc079bcecb4f73123ece1f5a46e1d98e0814` |
| production | 0 | 1 | 0 | `bfbf9f96dac0929d825779dce18ea0b5521f3891f90e94fd6b79a4490fef73a1` |

JSON検査で、変更リソースが`google_storage_transfer_job.tier_tokyo_to_osaka["recent"]`のin-place更新だけであること、差分が`repeat_interval: 86400s → 21600s`だけであることを確認した。バケット・保持期間・Bucket Lock・IAM・legacy・他区分・監査WORMはno-op。

saved planは機密データを含み得るためGitに保存せず、権限制限したローカル領域に置く。適用時にstateの世代・planのhashを再確認し、変更があれば再planして確認する。実行回数はrecentだけ1日1回から4回になる。新規世代だけをコピーするが、一覧要求・operation・ログが増えるため、実費はメトリクス・請求で確認する。

## 回帰検証

- バックアップ関連Nodeテスト18件成功。6時間遅延した12時間ごとの取得、転送直後の完成、転送1回失敗、複数回失敗による26h超過、復旧を実際の監視shellで検査。
- 権限不足、listing失敗、空バケット、欠損ペア、legacy互換、再転送で鮮度を更新しないこと、14h/26h境界を検査。
- 両対象異常時の独立通知と実際のjqによるJSON生成を検査。通知はローカルmockで、本番Discordへは送信していない。
- `terraform fmt -check -recursive`、隔離領域で`terraform init -backend=false`、`terraform validate`、mock providerの`terraform test`3件が成功。
- `npm run typecheck`、`npm run lint -- --max-warnings=0`、`bash -n`、`git diff --check`が成功。
- `npm run build`成功。`APP_ENV=test`、localhostのSupabase URLとCIと同じテスト専用ダミー鍵を使い、本番資格情報は使用していない。初回はsandboxのネットワーク制約でGoogle Fonts取得に失敗し、接続を許可した再実行で成功した。E2Eは実行していない。

Context7で2026-10-24にGoogle provider公式ドキュメントのStorage Transfer `repeat_interval`（最小1時間）と予定開始から遅れる挙動を再確認した。実plan/testは固定7.40.0で実施し、provider更新はしていない。

## クローズ前に残す証跡

2026-10-24、サービスオーナーからsaved planのStaging→Production適用、確認後のPR統合・Issueクローズ、本番メタデータ証跡のPR記載の明示承認を得た。planのhash、remote stateのlineage / serialが調査時から不変であることを確認して適用した。

| 環境 | 実ジョブ更新時刻 UTC | apply結果 | 適用後refresh plan |
| --- | --- | --- | --- |
| staging | 10/24 11:05:53 | 追加0・更新1・削除0 | No changes |
| production | 10/24 11:06:20 | 追加0・更新1・削除0 | No changes |

両環境のrecentはENABLED / 21600秒になった。適用時のremote stateロックは有効。転送ジョブの手動起動はしていない。
適用前commit `00c6ab8f768f081aafe4237ef73a5e0b00634126`の必須CIおよびBackup infrastructure検証は成功した。

残件:

1. 適用後のscheduled operation成功、東京／大阪の最新ペア・ハッシュ一致、14h/26h鮮度監視の成功を確認。手動転送・監視閾値変更で代替しない。
2. 最終commitのCI成功とmainへの統合を確認し、上記実績とともにIssue #103をクローズする。証跡が揃うまではPRの自動close文言を使わない。

次の予定転送機会は10/24 12:00 UTC（21:00 JST）。実開始は保証されない。ユーザーの依頼により21:10 JSTに同じタスクを自動再開し、結果を確認する。
