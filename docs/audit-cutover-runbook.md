# 監査 v2 切替手順（Issue #151 / G）

状態: **切替SQL・分類/外部control発行ツールとローカル試験を実装。Staging/Productionへの適用・外部設定・実接続試験は未実施**。
開始基点は `origin/main @ d20a3f2e1151f6369f2ea3b40d7aeb97ee6b884a`。依存統合後の検証基点は `origin/main @ 1311f3150a6819c7f0da964d8f56ff66bf301ac1`。
#149 / PR #156（A）と #150 / PR #157（B）の統合済みschema・dual読出し契約を使用する。実配備は別途確認が必要。
この文書の追加は、切替・新アーカイブ有効化・Issue完了の承認を意味しない。

正本: [監査設計 §3.2・7・9 R3](audit-chain-verification-design.md)、
[システム方針 §10・15](system-decisions.md)、[配備手順](deployment-runbook.md)。
環境ごとに [証跡テンプレート](compliance/audit-cutover-evidence-template.md) をコピーして記入する。
生の監査データ・識別子一覧・接続文字列・secretはGitや通常ログに置かず、非公開の証跡保管先へ保存する。

## 1. 実装・適用のゲート

| 段階 | 必要な事実 | 未確認・失敗時 |
| --- | --- | --- |
| 切替実装 | A/Bの統合済みcommit、確定したschema・canonical・baseline/control契約 | migrationを推測で作成せずDraftを維持 |
| ローカル検証 | 専用の使い捨てDB、合成データ、空DB/upgrade・2接続試験 | 共有DBを代用しない |
| Staging適用 | A/Bの実適用・実配備version、実bucket/IAM/retention、バックアップ、切替計画の承認 | 適用・設定変更を行わない |
| Production適用 | Staging実施証跡、Production自身の全前提の確認、対象と影響を限定した別承認 | Staging成功だけで適用しない |
| 新アーカイブ有効化 | 固定v1全量と旧export全generationの照合、外部baseline/controlの発行・読戻し・DB外固定 | 未完了を記録。v1書込へ戻さない |
| 完了判定 | 各環境の適用結果、全量保全receipt、復元/中断試験、残課題 | 未適用環境を完了扱いせずIssueをcloseしない |

A/BのIssueがcloseしたことや、SQLファイル・Terraformの存在だけでは実配備を証明しない。
依存統合後は最新mainから差分を照合し、A/B契約変更に合わせて本手順とGの実装を再レビューする。
切替migrationはA/Bの未統合branchから取り込まず、既存migrationも編集しない。

## 2. 環境・変更範囲を固定する

実施者は環境ごとに以下を証跡へ記入する。値のない欄は未確認とする。

1. Supabase Project ref、DBのPostgreSQL version、Vercel Project/配備URL/SHA、GCP Project、監査bucket、切替UUIDを固定する。接続先の環境一致を読取りで確認する。
2. A/Bのmigration名・digest・適用履歴とアプリ配備SHAを照合する。Bのinventory経路でNULL hash/globalを含む取得と旧/新アプリの互換性を確認する。
3. migration history、対象SQLのdigest、dry-run、差分を保存する。対象外migrationが含まれた場合は止める。dry-runを適用成功と記録しない。
4. 最新完全backupの世代・digest・完了時刻・データ時刻・確認時刻と鮮度を記録する。14時間基準を超過、不明、復元不能なら適用を止める。監査保全の26時間基準とは区別する。
5. 10年監査bucket、既存7年bucket、保持期間、lock、IAMを実設定と照合する。writer/verifierとcontrol operatorの資格情報を分離する。bucket/IAM/secret/Cron/Lockの変更は個別の承認範囲に含める。
6. 実施窓のUTC開始・終了、許容lock待機秒、statement timeout、業務影響の上限、異常時連絡先を具体的な値で承認する。未指定のままSQLを実行しない。

## 3. 旧jobのdrainと切替transaction

旧日時checkpointのjobとBのpublisherについて、scheduled/manual/API再送の起動経路をすべて列挙する。
承認範囲で旧jobの新規起動を停止し、配備をまたぐin-flight実行の完了をrun ID・開始終了時刻で確認する。
「次のscheduleまで待った」だけではdrain成功としない。失敗・応答不明の実行は保存済みobjectのgenerationとreceiptまで照合する。
Bを再開する条件・設定・担当者も停止前に決め、無計画な監査保全の空白を作らない。Bの専用endpointは `/api/cron/archive-audit-v2`、旧endpointは `/api/cron/archive-audit`。依存PRの統合後も旧route/Cronは維持し、承認された切替時にだけ接続を変更する。

Gの[手動切替migration](../supabase/manual-migrations/20261025000001_audit_v2_cutover.sql)のtransaction契約:

1. transaction内の `SET LOCAL lock_timeout` とstatement timeoutを設定し、`audit_events`へのINSERTと競合するtable lockを取得する。lock待機中の業務書込への影響も監視する。
2. 既にINSERTしたtransactionの終了を待った後、承認済み切替UUIDを使い、Aのv2 trigger接続とversion defaultを同一transactionで変更する。旧triggerとの二重接続を残さない。
3. 前提schema・trigger/default・既存headが想定外なら拒否する。切替UUIDをその場で自動生成したり、既存scopeをGENESISへ戻したりしない。
4. 切替境界・対象versionを証跡へ記録しcommitする。lock timeout/SQLエラー時は全変更をrollbackし、別接続からtrigger/defaultが切替前のままであることを検査する。
5. commit後はversion省略の旧アプリINSERTがv2になること、明示v1/任意hash・連番持込みが拒否されることを確認する。既存v1全列・hash・versionは変更しない。

migrationの自動適用経路も調べ、対象環境・切替UUID・承認が確定する前に共有DBへ適用されないようにする。
切替SQLは通常の `supabase/migrations/` から分離する。通常の `migration up` やアプリ配備で、A/Bの実配備・運用承認より先に切り替わることを防ぐためである。通常migration履歴へ適用済みと偽装せず、SQL名/digest・切替ID・承認証跡digestを運用記録と `private.audit_cutover_state` に残す。新規環境もA/Bは自動再構築できるが、v2への切替には同じ手動ゲートを通す。

## 4. 固定v1のinventoryと異常分類

切替commit後のv1全行を対象にする。切替前のB inventoryは暫定であり、確定baselineへ読み替えない。
NULL hash/globalを除外せず、A/Bで確定したversion別canonical bytesをそのまま保管する。
件数・sequence・ordinal・generationは10進文字列、日時はマイクロ秒を保持し、JavaScript Number/Dateによる丸めを避ける。

| 分類 | 記録する内容 |
| --- | --- |
| NULL | hash/previous_hashのNULL、対象件数。globalは除外条件にしない |
| 参照切れ | 保存previous_hashに対応する前イベントが存在しない箇所 |
| 分岐 | 同一前hashを参照する複数行、hash衝突・重複による曖昧な参照 |
| 複数GENESIS | scope内の複数起点とその範囲 |
| 循環 | 保存previous_hashをたどって循環する範囲 |
| 再現不能・不一致 | 証跡のあるTimeZone/DateStyle設定での再計算結果と保存hashの不一致、当時の設定不明 |

分類は重複し得る。全行数と分類別件数を単純加算して一致させない。
再計算には各行の保存previous_hashを使う。日時/UUID順に並べ直して鎖を作り直さない。
運用証跡にない設定を総当たりして合格にしない。異常を自動修復・accepted-risk化しない。
異常一覧の非公開object receiptと提供判定への影響を残し、判断者へ報告する。

旧exportは全objectの全generationを列挙し、当時のschema列で新inventoryと照合する。
分割exportを集計して、全体として未収録の行と単一chunkに不在の行を区別する。
NULL hash等で旧exportから漏れていた行も、新baselineには保存する。

## 5. baseline/controlを外部固定する

1. control operatorが、切替ID、固定v1の件数・digest・scope別inventory、異常一覧、旧export照合結果、v2開始条件、検証ツールversionを非公開で保存する。
2. Bの正式なinventory receiptと全量照合したbaselineをcreate-onlyで発行する。Bの確定契約に従い、異常は未解決として保持する。初回基準点以前の無改ざんを遡及保証しない。
3. object名・generation・size・SHA-256をgeneration指定の読戻しで照合する。応答喪失では同名objectを照合し、同一内容のみ再利用する。異なる内容なら上書きせず停止する。
4. 同じ切替IDとbaseline receipt、前controlへの参照を持つcontrolを専用権限で発行・検証する。writer/verifierにcontrolの発行権限を渡さない。
5. baseline/controlのobject名・generation・digest・切替IDをDB外の承認済み環境設定へ固定し、変更履歴を残す。DBやwriterが提示したGENESISを自動採用しない。
6. 全量保存・照合と設定読戻しが成功してから、別途承認されたBのv2系列を有効にする。旧checkpointを転記せず、外部の連続manifestを進捗の正本とする。
7. 最初の完全receipt、scope別head、次ordinal、backlog、26時間鮮度監視・予定未実行検知を確認する。孤立chunkやinventory完了だけをv2全量保全成功としない。

失敗時は切替を未完了と記録し、Bのdual読出しでv1/v2を保全する。Bのinventory modeがv2を正式保存しない契約なら、v2未保存範囲・件数・最古時刻を明示し、容量と保全遅延を監視する。
「dual読出しを配備した」だけで全量の外部保存成功とは記録しない。

## 6. 復元・中断からの再開

復元DBでは業務書込・archive publisherを再開する前に、DB外に固定した最新control/baselineと正式manifest系列を読み、切替ID・最新ordinal・scope別sequence/headを照合する。
旧checkpointは参考値とし、同じ連番の再採番、GENESIS自動リセット、新切替IDの自動採用を拒否する。

| 状態 | 対応 |
| --- | --- |
| manifest保存後にDB cache更新失敗 | generation/digestを検算した外部連続系列から進捗を復元し、未保存範囲だけ再送 |
| baseline/control作成中に失敗 | 保存済みgenerationを照合し、未完了段階から再開。有効化を先行しない |
| 復元DBが外部headより古い | 書込を停止したまま、外部イベントとheadの整合復旧手順を個別承認 |
| receipt欠落・分岐・digest不一致 | 元object/DBを保全して事故記録。自動修復・外部receiptの削除/巻戻しをしない |
| 整合復旧不能 | 欠落範囲・影響・保全済み証跡・再開方法と承認者を固定するまで再開しない |

切替後のrollbackとしてv1書込を再開しない。v2と監査保全を維持し、追加migrationで前進修正する。
監査書込不能時は重要操作を拒否し、監査を迂回するfallbackを作らない。

## 7. 必須試験と結果の区別

以下が必須試験。ローカル結果は§8に記録し、実Staging/Productionと区別する。単なるSQL mockやA/Bの試験結果をGの証明へ流用しない。

- 空DB/upgradeで全既存v1列・hash・version不変、RLS/ACL、旧アプリversion省略と新アプリ、v1持込み拒否を実DBで確認する。
- 2接続で、切替前にINSERT済みのtransactionによるDDL待機、切替待機中のINSERT、切替前に開始した未INSERT transactionの切替後INSERTを確認する。Read Committed/RR/Serializableで、commit成功した行はv2、拒否時は全rollbackとし、境界後のv1追加がないことを調べる。
- 別接続でlockを保持しtimeoutを実発生させ、trigger/default/切替状態が部分変更されないこと、解除後の再実行とrollbackを確認する。
- NULL/global・参照切れ・分岐・複数GENESIS・循環・不一致・再現不能の合成fixtureを分類し、未解決を維持する。
- baseline途中失敗、create-only競合/応答喪失、DB cache更新失敗、古いDBからの復元・再開拒否をStaging合成データで確認する。
- `security_hardening.test.sql`、関連pgTAP/unit、型生成差分、typecheck、警告0のlint、buildを実行する。E2Eはユーザー確認後に限る。

ローカル、Staging、Productionの結果は別欄にし、実行時刻・対象version・run URL・非公開証跡receiptを添える。
RLS/permissions変更時は双方を照合する。準拠・release checklist・週次検証Cの完了を先行更新しない。

Context7確認: 2026-10-25、Supabase公式資料のtransaction単位migration、`SET LOCAL lock_timeout`、migration history。
対象はrepository固定Supabase CLI 2.108.0 / PostgreSQL 17。追加でPostgreSQL17のDDL lock・deadlock_timeout権限とGCS SDK7系のcreate-only/generation読出しを確認した。取得資料はmainを含むため、固定依存版で検証する。

## 8. 実装と実行方法

### 手動切替SQL

`supabase/manual-migrations/20261025000001_audit_v2_cutover.sql` は **BEGIN/COMMITを含む独立transaction**。
承認済みの環境専用PG service/資格情報を使い、sessionに次の2つを設定してから、`psql -X -v ON_ERROR_STOP=1 -f` で実行する。
外側のtransactionに入れたり、通常migrationディレクトリへコピーしたりしない。

- `care_record.audit_cutover_id`: 環境ごとに事前確定・承認したUUID。ツールが自動採番しない。
- `care_record.audit_cutover_evidence`: 対象環境・A/B配備SHA・backup freshness・drain結果・SQL digest・承認記録を含む、非公開の適用証跡ファイルのSHA-256。

SQLの上限はlock待機5秒、statement30秒。ACCESS EXCLUSIVEを待つ間、後続の読取/書込も待機し得る。
この上限と影響を実施窓で承認し、合わない環境には無断で値を緩めて適用しない。
A/Bの存在、v1 default/trigger、有効な証跡digest、未切替・headなしを検査し、違えば全rollbackする。
`private.audit_cutover_state` はRLS有効、全APIロールの権限なし、UPDATE/DELETE拒否のsingleton境界記録。
業務`permissions.ts`と既存監査閲覧RLSは変更せず、内部境界管理を業務権限へ公開しない。

適用後はこのoperator接続で切替stateを読み、cutover_id、boundary_at、v1_count、evidence_digestを非公開証跡へ記録する。
`boundary_at`はlock取得後の時刻でありcommit時刻ではない。Bの固定snapshotは切替commit後に新規作成し、run IDとDBのstarted_atも採取する。
通常migration historyとは別に、手動SQLの名前/digest・実行時刻・成功/失敗を残す。

### 分類とv1 hash再計算

`node scripts/audit/cutover-inventory.mjs private-chunks.json private-report.json [private-recomputation.json]` はoffline専用。
入力は、generation固定で取得・receipt検算済みのB chunkのJSON配列。v1以外を混ぜず、全行を渡す。
raw inventory bytesをSHA-256化し、scope/id順のBの累積digest・件数を計算する。
NULL/global、参照切れ、分岐、複数GENESIS、循環、重複hash・曖昧な参照を分類する。
入力や既存イベントを変更せず、報告はcreate-only・mode0600で作る。

再計算設定がない場合、全行を`unreproducible`とする。根拠のある当時のTimeZone/DateStyleを指定したoperatorのread-only DB接続で、
保存previous_hashを使う `private.audit_canonical_v1(e)` のSHA-256を計算する。DBのtimestamp/detailsをJavaScriptで再serializeしてhashを代用しない。
再計算JSONは次の形式で全行を含める。設定証跡digestがない場合、部分行・重複ID・不正hashは拒否する。
一致した場合もhistoricalVerdictは`unresolved`を維持し、過去の改ざん不存在を宣言しない。

```json
{
  "schema": "audit-v1-recomputation:1",
  "settingsEvidenceDigest": "当時の設定を裏付ける証跡のSHA-256",
  "timeZone": "証跡のあるTimeZone",
  "dateStyle": "証跡のあるDateStyle",
  "rows": [{"id": "監査行UUID", "hash": "DB再計算のSHA-256"}]
}
```

### baseline/control発行

`node scripts/audit/cutover-control.mjs publish private-plan.json private-pins.json [private-recomputation.json]` を、
実bucket/IAM確認・環境別承認後にcontrol operatorのWIF/ADCで実行する。
`APP_ENV`、`GCP_PROJECT_ID`、`EXPECTED_GCP_PROJECT_ID`、`GCS_AUDIT_BUCKET`は承認した環境だけを指定する。
DB service-role keyは不要。writerの資格情報を流用しない。

planの契約:

| フィールド | 内容 |
| --- | --- |
| schema / environment / cutoverId | `audit-cutover-plan:1` / `local`・`staging`・`production` / 承認済み切替UUID |
| evidenceDigest | 手動切替に使った適用証跡のSHA-256 |
| evidence | `aDeployment`・`bDeployment`・`backupFreshness`・`oldJobsDrained`・`legacyExportsReviewed`・`migrationApplied`・`approval`それぞれの確認証跡のSHA-256 |
| boundary | DBから読んだ`cutoverId`・`v1Count`（10進文字列）・`at`（boundary_at）と、外部writerとは独立したDB全量inventoryから計算する`v1Digest` |
| inventoryRun / snapshotStartedAt | 切替commit後に開始したB run UUIDとDB started_at |
| inventoryReceipts | `archive/<environment>/pre-cutover/manifests/1.json`から、当該runの最終inventoryまでの全receiptを順序どおりに列挙 |
| previousControl | DB外に固定済みのpreparation control receipt |
| monitoringStartedAt | 新系列の監視開始時刻。再送時に変更しない |

各receiptは`name`・`generation`・`size`・`digest`。数値は10進文字列。
ツールはgeneration指定で外部objectを読み、全receiptの連番・前digest、当該runの全chunkと累積v1 digest・件数、独立したDB全量inventoryのdigest・境界件数、snapshot時刻を照合する。外部manifestのdigestをDB照合値へそのまま転記しない。
証跡digestの存在は検査するが、A/Bが実配備済みか、legacyの全generationを人が確認したかを自動で保証しない。証跡本体のレビューを省略しない。

異常は500行ずつの内容hash名objectに分け、分類summary、B互換`audit-baseline:1`、前controlを参照する`audit-control:1`を順にcreate-only発行する。
全response/objectは1MiB以下。名前は`control/<environment>/<cutoverId>/`配下へ固定し、別内容の再送は拒否する。
412/応答喪失では既存bytes・generationを読戻し、同一内容のみ再利用する。途中失敗後も同じplanで再開できる。
`private-pins.json`はDB外設定へ固定するreceiptで、ツール自身は設定・Cron・archive modeを変更しない。
既存の出力ファイルを上書きせず、再照合用の新規非公開ファイルへ出力する。

### 復元時の照合

`verifyRestoredDatabase(external, database)` はoperatorの照合コード向けの純粋関数で、DB更新やcontrol再発行をしない。
`external`はDB外固定の最新controlと、generation/digestを検算した正式manifest系列から採るcutoverId・ordinal・v1Count/v1Digest・heads。
`database`は復元DBからの同じ情報で、headは`scope`・`sequence`・`hash`・`cutoverId`を持つ。
DBが外部headより先なら、外部sequence位置の保存hashを`archiveAnchorHash`として追加で照合する。
古いhead、同連番の別hash、別切替ID、v1 digest差異は拒否する。外部系列自体の連続性の検算はBのpublisherと同じ読取り契約で先に行う。
関数が返す`consistent`はこの入力間の一致であり、復元DBの全行再計算や週次検証Cの代わりにしない。

### ローカル検証（2026-10-25）

専用Supabase CLI2.108.0 / PostgreSQL17.6の合成DBで、A/Bの空DB再構築と関連pgTAPを実施。
ローカルCLIの既存SQL分割エラーに対しては、migration実行無効の新規専用stackに未変更SQLをpsqlのtransactionで順次適用した。
CLI `db reset` で全migration適用が成功したという意味ではない。GitHub CIの通常空DB/upgrade結果はPRを参照する。

`test-audit-cutover.mjs` は同じ専用stack内にschema-onlyの空DBと、所有者・ACLを保持した論理dump/restore DBを作り、手動切替SQLそのものを実行する。
実lock timeoutで全rollback、DDL待機中INSERT、切替前開始のRC/RR/Serializable、version省略の旧アプリ、既存v1行の不変、v1持込み拒否、RLS/ACL・境界の追記保護を検査する。v2の実論理backup/restore後のhead一致、backup後の古いhead、同連番・別hashの再開も照合し、後2者を拒否する。
40001はtransaction全体をrollbackし、v1へfallbackしない。開発/共有コンテナ名はDockerを呼ぶ前に拒否し、試験後は専用stackを破棄する。管理ロールの復元接続は専用コンテナ内部の既存ローカルpasswordを使い、値をホスト引数・ログへ出さない。

```sh
node --test scripts/audit/*.test.mjs
node scripts/db/test-audit-cutover.mjs supabase_db_care-record-audit-v2-test-151
```

offline/メモリStore試験は異常分類・精度・control途中失敗/再開・別内容再送拒否・古いsnapshot拒否を確認する。
`auditCutoverFlow.test.ts` は実B publisherで発行したinventoryからGのbaseline/controlを発行し、Bの新系列がそのreceiptを受理することを確認する。
実GCSのIAM拒否・create-only、Staging切替、Production適用は未実施であり、Issue完了・準拠完了として扱わない。

### CI復元fixtureの修正（2026-10-26）

CIの管理ロール認証は専用コンテナ内の既存passwordを使用する。
Supabase管理の`graphql_public.graphql`はextension hookで用意される版があり、
pg_dumpのACLだけを空DBへ復元すると関数不在で停止する。
この監査復元fixtureは`graphql_public`を通常dumpから除き、ACLからの参照を保つため、
復元元の`pg_get_functiondef`で取得した実wrapper定義と所有者を先に復元する。
ダミー関数は作らず、他のアプリ/public・private・Auth・Storage、所有者、ACL、trigger、
監査データを保持し、復元エラーは引き続き`ON_ERROR_STOP`で拒否する。
wrapperのSQL依存は後続のextension復元で揃えるため、pg_dumpと同じく復元時だけ
`check_function_bodies=false`を使う。稼働中のアプリや元DBの設定は変更しない。
この試験は監査切替と復元後の連番/head照合を対象とし、プラットフォーム全体の
Supabase復旧成功を証明するものではない。

当初、固定CLI2.108.0のローカル既定値はDBイメージ`17.6.1.139`だった。
その後、リポジトリの`.temp/postgres-version`だけを専用設定へ複製し、CIと同じ
`17.6.1.063`で旧fixtureの失敗を再現した。同一イメージ上で修正後の空DB・切替・
timeout・2接続境界・実v2 dump/restore・同連番異hash拒否がすべて成功した。
最終のGitHub CI結果は別途PRへ記録する。Context7で2026-10-26にPostgreSQL17の
pg_dump/extension member・schema除外・template0への復元契約を再確認した。
