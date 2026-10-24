# 監査アーカイブ B（#150）

実装基点: origin/main `d20a3f2e1151f6369f2ea3b40d7aeb97ee6b884a`。
依存: #149 の `20261024000001_audit_v2_foundation.sql`。依存が main に未統合の場合、この PR は draft とし、B 単独の migration 適用・配備はしない。
設計正本は [監査設計 §4](audit-chain-verification-design.md)。準拠・WORM・本番稼働をこの実装だけで確認済みにしない。

## 配備と有効化

1. A の準備 schema の適用・配備と旧アプリ互換を確認する。B の migration は追加のみで、監査イベントや v1 trigger/default は変更しない。shared/production への適用は手動承認の対象。
2. 新しい環境別10年監査 bucket を実確認する。`GCS_AUDIT_BUCKET` は名前に `-staging-` または `-production-` を含める。既存の `care-record-archive-7y` 等は `GCS_AUDIT_LEGACY_BUCKET` として区別し、既存 object・generation・lock・保持期間を維持する。移動・削除・保持短縮はしない。
3. operator が `control/<environment>/preparation.json` を create-only で発行し、name/generation/SHA-256/size を DB 外の環境設定 `AUDIT_CONTROL_*` に固定する。DB に提示された切替IDや GENESIS を設定へ自動転記しない。前の control と承認記録も保管する。
4. B の配備切替は、既存 Cron の停止・in-flight drain・新設定投入を計画して別途承認する。本 PR は `vercel.json`、稼働中 Cron、secret、IAM、bucket を変更しない。新ルート `/api/cron/archive-audit-v2` は未設定では503で停止する。既存 `/api/cron/archive-audit` と `vercel.json` の旧日次jobは配備後も維持する。Gの承認済み切替時に旧jobを停止・drainし、設定/準備control固定後の新endpointへ接続する。新旧を同時に正式publisherとして運用しない。旧日時 checkpoint や HMAC 受信結果を新系列の receipt に使わない。
5. 準備段階は `AUDIT_ARCHIVE_MODE=inventory`。v1 を毎回全量 snapshot として保全し、NULL hash/global を含める。遅れて commit した過去日時の v1 は次回の全量取得に含む。完了 receipt は `kind=inventory`、HTTP 202/`ok:false` で、確定 baseline・v2 完全保存とは扱わない。
6. G の切替後も inventory mode で **全 v1** の収集を完了する。この mode は同居する v2 を正式系列へ発行しない。固定した v1 集合、全旧 export/generation、件数・差異・未解決異常を照合し、G で baseline を承認する。切替前の receipt を、後から承認なしに確定済み扱いしない。
7. G が発行した baseline/control の receipt を別権限で固定し、`AUDIT_ARCHIVE_MODE=v2` にする。baseline と参照 inventory receipt の v1 count/digest が異なる場合は停止。確定済み v1 の DB 全行再照合は週次 C で実施する。新切替ID・GENESIS を自動採用しない。新 control は前 control を参照する承認済み更新として管理する。
8. Staging で下記の非本番実試験後、Production の設定・配備を別途承認する。週次検証と提供チェックの完了は後続 C の証跡が揃うまで変更しない。

準備 control の JSON（値は合成例。実行時には環境専用の正確な receipt を設定する）:

```json
{"schema":"audit-control:1","environment":"staging","cutoverId":"pre-cutover","baselineFinalized":false,"baseline":null,"monitoringStartedAt":"2026-10-25T00:00:00.000Z"}
```

G の baseline object は `control/<environment>/` 配下に置く。形式は `audit-baseline:1`、environment、cutoverId、v1Count（10進文字列）、v1Digest（下記全量 digest）、inventoryReceipt（B の `kind=inventory` manifest の name/generation/size/digest）、`historicalVerdict:"unresolved"`。既知の v1 異常を合格に変換しない。G の control は同じ切替ID、`baselineFinalized:true` と baseline object の receipt を持つ。G が全旧 object との照合と切替境界を確定したことを確認してから投入する。

## 保管契約と復旧

- `begin_audit_archive(positions, include_v1)` は単一 SQL statement の同一 snapshot で全 scope/head と未保存行を private table に固定する。v2 の下限は外部の正式系列から復元した連番のみを使い、DB cache を採用しない。v1/v2 の canonical inventory を DB 側で UTF-8/base64 化し、全ページを `(kind, scope, sequence, id)` の keyset で取得する。v2 は scope/sequence 順。日時順を連番の代替にしない。run の対象は処理自身の `audit.archive` を含めて伸ばさない。
- v1準備は全量、baseline確定後は未保存v2だけを snapshot に保持する。確定後の v1 は G の immutable baseline を参照し、日次に全量複製しない。既存保全範囲の全行照合は週次 C の責務。自動物理削除はしない。新規監査量・中断run・scope/headの増加量を容量安全弁と照合して運用する。SQL timeout で部分 snapshot は commit されない。
- inventory schema `audit-inventory:2` は固定配列。id、event_id、organization_id、actor_id、action_type、resource_type、resource_id、outcome、request_id、session_id、reason、UTC小数6桁created_at、details、ip_hash、user_agent、previous_hash、event_hash、integrity_version、chain_scope、chain_sequence文字列、chain_cutover_id をこの順で保護する。v1 の歴史的 hash を再計算・再付与しない。
- v1 全量 digest は初期値 SHA256(empty) から、SQL の scope/id 順に `SHA256(previous digest の32 bytes || [id, SHA256(raw inventory bytes)] の compact JSON UTF-8 bytes)` を反復する。canonical bytes 自体を chunk に保存し、日時や JSON の再 serialize で hash を置換しない。v2 の hash は A の canonical bytes に対して検算する。
- chunk は `archive/<environment>/<cutover-id>/chunks/<SHA256>.json`。manifest は `archive/<environment>/<cutover-id>/manifests/<ordinal>.json`。ordinal は1から連続する10進文字列。前 manifest の digest と chunk の generation/size/digest を格納する。chunk 自体にも全行inventory・scope/head・範囲がある。manifest 発行が commit 点。
- 作成は `ifGenerationMatch=0`。412/応答喪失では generation 指定で読み直す。同一 chunk は再利用し、異なる chunk は停止。固定名 manifest の勝者が異なる場合は勝者を検算し、未保存の範囲を再計画する。敗者の孤立 chunk は残すが成功件数に数えない。
- 起動時に manifest prefix を list し、欠番を拒否する。連続系列をすべて generation 指定で検算・再生して進捗を復元する。manifest 内の run ID・返却済み cursor・累積 v1 digest/count・固定 head から中断 run を再開し、予算切れのたびに v1 の先頭へ戻らない。DB の progress cache は読み出し下限や ordinal の正本に使わない。manifest 後に DB 更新が失敗しても次 run は外部系列から復旧する。
- receipt 欠落・別generation・digest差異・scope消失・復元DBの古い head・連番の改変は非成功。外部に合わせて DB を自動修復したり、DB に合わせて外部系列を巻き戻したりしない。事故記録と承認済み復旧手順へ接続する。
- 行/件数/ordinal/generation は10進文字列、演算は BigInt。DBページは最大500行かつ512KiB（全JSONB）、アプリ/GCSは全 response 1MiB。大きすぎる単一行は失敗し、飛ばさない。cursor は最後に返した行だけを指す。
- API は CRON_SECRET 必須、環境不一致は読出し前に拒否。全結果 `private, no-store`。raw例外、組織/event識別子、canonical bytes を通常ログや response に出さない。通常業務の認可や RLS を変更しない。

## 旧 schema export の照合

保管管理者が旧7年 bucket の **全 generation** と新 inventory chunk を generation 固定で非公開の作業場所へ取得する。各旧 JSON は `schemaVersion:1` を確認する。

```sh
node scripts/audit/legacy-compare.mjs private-chunk.json private-legacy-export.json private-report.json
node --test scripts/audit/*.test.mjs
```

このツールは旧 schema に存在した18列を比較し、旧列欠落・差異・重複・当該exportに不在の行・当該chunkに不在の行を件数で記録する。A の新3列不在は不一致にせず、過去に証明されていない列として残す。数値を丸めず、UTCのマイクロ秒を保つ。未記録列の一致を推測しない。報告は create-only/private mode。全 object/chunk の組合せを集計してから、未収録行と export 分割による不在を区別する。単一の比較結果だけで旧全量照合完了としない。

## 実 bucket / IAM / retention の確認

IaC は [新規独立state](../infra/terraform/audit-archive/README.md) に用意する。既存 backup state を移動・変更しない。writer/verifier/control の別SA、prefix条件付き create/get、監査専用bucketのlistを定義し、WIF bindingは明示設定まで空にする。適用は別途承認する。

変更前に operator が環境名、GCP Project、bucket 名、照合時刻を記録する。以下は読取確認。出力は非公開の運用証跡へ置く。

```sh
gcloud storage buckets describe gs://BUCKET --format=json
gcloud storage buckets get-iam-policy gs://BUCKET --format=json
gcloud storage ls --all-versions --long gs://LEGACY_BUCKET/audit/
```

実10年 retention（最低3653日）、retention lock 状態、public access prevention、uniform access、lifecycle が10年未満で消去しないこと、既存7年 bucket の設定不変を確認する。Terraform 定義の存在だけで実 bucket の一致を保証しない。Lock が未設定なら管理者による変更不能と主張しない。不可逆な Bucket Lock は saved plan と影響を提示し別途承認する。

| 主体 | 許可する操作 | 禁止する操作 |
| --- | --- | --- |
| archive writer | 自環境 archive prefix に create/get、再送/欠番確認に必要な list、control prefix の get | archive 上書き/delete、verification/control 作成、bucket設定変更 |
| verifier | archive/control の get/list、verification prefix の create/get | archive/control 作成、上書き/delete |
| control operator | 承認済み control の create/get/list | writer/verifier と資格情報を共有しない |

`storage.objects.list` は prefix IAM condition だけで object 単位へ絞れない場合があるため、監査専用bucket内の list を個別に承認し、get/create は prefix に制限する。`objectCreator` だけでは再送照合できない。`objectViewer` の bucket 全体付与を安易に writer/verifier の相互読み書き権限へ拡大しない。GitHubからの操作は既存と同じ環境別 WIF/OIDC を使う。

Staging 専用合成 object で、同名 create 2回（2回目412）、異なる内容の再送拒否、応答喪失の再照合、正確なgeneration指定get、writerのcontrol/verificationへの作成拒否、verifierのarchive作成拒否、双方のdelete/overwrite拒否を検証する。試験 object は保持し、自動削除しない。本 PR 内で実 bucket/IAM を変更・検証したとは扱わない。

## 独立監視と秘匿通知

既存日次 Cron とは独立した毎時の監視から `scripts/audit/monitor.mjs` を起動する。接続は G の baseline 確定・環境承認後。既存 DB backup の閾値や schedule は変更しない。

- `APP_ENV`、`AUDIT_MONITOR_ORIGIN`（固定 HTTPS origin）、`CRON_SECRET`、`DISCORD_ALERT_WEBHOOK_URL`、`EVIDENCE_URL`（GitHub Actions run URL）を環境別に設定する。secretを query に含めず redirect を拒否する。
- health は外部系列を読み、最後の完全 receipt から26時間超を `archive_stale` とする。成功履歴なしは control の `monitoringStartedAt` から計時する。未完了/最新chunkのみ/まだinventoryの系列は `archive_incomplete`、読取不能は unavailable。いずれも非成功。
- 通知は Critical、環境、固定分類、run URL だけ。応答本文・例外・識別子は出さず、通知失敗でも非0終了とする。監視自体の予定未実行も既存の外形監視側で確認する。監視 workflow の実接続と未実行通知の証跡は配備時に必要。

## 確認記録

2026-10-24〜25、Context7: Google Cloud Storage Node SDK7系の create-only precondition と generation 読出し、PostgreSQL17の同一statement snapshot/SECURITY DEFINER、Terraform Google provider7.46.1のprefix IAM条件・custom role・不可逆なretention lockを確認。インストール済み Next.js16.4.3 の Route Handlers guide も確認。SDK7.21系は generation string を Number に変換するため、読出しは SDK の認証を使用した JSON API へ decimal string を直接渡す。

検証コマンド（A/B を空DBへ適用した、専用の使い捨てローカルstackのみ）:

```sh
psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/audit_archive.test.sql
psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/security_hardening.test.sql
node scripts/db/test-audit-archive-concurrency.mjs supabase_db_care-record-audit-150-test
```

並行試験は専用名を強制し、合成データを commit する。最後に実行してそのstackを破棄する。Gの切替fixtureはこの試験DB内だけで有効化する。E2Eは別途ユーザー確認が必要。

合成10万件の v1 初回 snapshot は約1.42秒、snapshot relation は約92MB（既存試験の割当を含む）。この測定を受け、確定後の日次runは未保存v2だけを複製する。準備段階の全量v1 snapshotは長期間放置せず、Gへの切替計画と容量安全弁で管理する。外部系列の再生は全manifest/chunkを検算するため、履歴量とGCS latencyで40秒（health20秒）の予算を超えた場合は非成功となる。運用想定の系列長で測定し、予算に収まらない環境では配備前に実行基盤を拡張する。未測定の長期運用可能性を保証しない。

ローカル試験・非本番接続・本番配備の結果はPRへ区別して記録する。未merge依存を試験DBにだけ追加した検証は、main単独での再構築成功とは記載しない。
