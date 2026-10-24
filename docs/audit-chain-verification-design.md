# Issue #101: 監査チェーン検証と認可回帰テストの設計

作成日: 2026-10-24。調査基点: `origin/main @ 0c043866b851f4950f5bca08d15e3ad958021503`。
対象: [Issue #101](https://github.com/shougayaki-1/care-record/issues/101)。状態: **後続実装の設計方針。実装・実DB検証・本番設定確認は未実施**。

承認済み方針の正本は [system-decisions.md](system-decisions.md) §4・10・15、準拠判定は [compliance/README.md](compliance/README.md) に従う。旧patchはIssue内に保全し、直接適用しない。新たなaccepted-riskは登録しない。旧branchの整理は #102 の責務とする。

## 1. 採用する方針

1. 既存監査行（v1）を変更せず保全する。既存hashの付け直しや並び替えによる修復はしない。
2. 新規イベント（v2）は組織ごと、組織なしはglobalの独立した連番とheadを持つ。日時・UUIDをチェーン順序の正本にしない。
3. DB内の再計算と、外部不変保管のイベントinventory・件数・head照合を組み合わせる。DB内checkpointだけでは合格にしない。
4. 週次検証はGitHub Actions、日次保管はアーカイブ処理として分離する。API/RPCは短いチャンクの読出しを担い、全走査を1リクエストで完結させない。
5. 認可テストは既存ケースを再利用し、利用者Action、super-admin、失効・担当scope・直接アクセスの不足ケースを補う。認可ポリシーの変更は別責務とする。

以下の試験・実装名は後続Issueの計画であり、今回実行・実装したものではない。

## 2. 現行mainの事実と解消する差分

| 対象 | 現行実装 | 解消する点 |
|---|---|---|
| 挿入hash | init migrationの`private.chain_audit_event()`。組織/globalのtransaction advisory lockを取り、`created_at DESC, id DESC`の先頭を前イベントとする | 同時刻のランダムUUID順は挿入順と一致しない。`now()`はtransaction開始時刻でcommit順とも一致しない。ロックだけでは順序の問題を解消しない |
| v1正規化 | `concat_ws`、区切り文字、`created_at::text`、`details::text`。NULLと空文字を同一化。`id`、`ip_hash`、`user_agent`、`integrity_version`はhash対象外 | 過去の保証範囲を限定して記録。TimeZone/DateStyle依存と区切り文字の曖昧さをv2へ持ち込まない |
| 追記保護 | `audit_events_no_update`はUPDATE/DELETEを拒否 | trigger/ACLの存在だけで検知能力を証明しない |
| アーカイブ | 日次最大500件、日時/event_id順、NULL hashを除外。checkpointは最終日時とevent_id | 500件超の滞留、同時刻境界、遅いcommitによるcheckpoint以前の行の取りこぼし、NULL除外を解消 |
| 保存先 | APIは`care-record-archive-7y`固定、Terraformは環境prefix付き`audit-worm`と10年保持 | 実bucket・IAM・retention/lock・object generationを確認するまで保存先の一致や本番WORMを保証しない |
| checkpoint | `audit_archive_checkpoints`はDB内の転送位置のみ | 進捗と改ざん検知の信頼点を分離する |
| 週次検証 | RPC/API/workflowは見当たらず、release checklistも未チェック | 稼働と改ざん検知の証跡が揃うまで未チェックを維持 |

参照: [init migration](../supabase/migrations/20260630235959_init.sql)、[アーカイブAPI](../src/app/api/cron/archive-audit/route.ts)、[GCS helper](../src/utils/gcs/upload.ts)、[bucket定義](../infra/terraform/backup/main.tf)、[service role台帳](../scripts/security/service-role-operations.json)。

## 3. チェーンの正本・正規化・既存ログとの互換性

### 3.1 v2の書込契約

- scopeは組織UUIDから作るkeyと予約値`global`を区別する。組織IDなしのイベントも検証・保管対象とする。
- 新規head tableにscopeごとの`last_sequence`と`last_hash`を保持する。headをロックし、採番・挿入・head更新を同じtransactionで行う。rollbackは採番も戻す。`nextval()`はrollbackされず欠番が生じるため、連続性の正本にはしない。
- commit済みv2連番はscopeごとに1から連続する。同一transaction複数行、2接続同時実行、逆のcommit順、rollback、新規scopeの同時生成で確認する。複数scopeのlock順とdeadlock時のrollbackも試す。
- audit_eventsにはnullableなv2連番等を追加し、既存行をUPDATEしない。新migrationはversionのdefaultを2に変更し、新triggerはversion=2、連番、前hashを決定して任意値の持込やv1へのdowngradeを拒否する。旧アプリがversionを省略するINSERTも受け付ける。scope/連番の重複を制約で拒否する。
- 正規化はversion別DB関数を正本とする。v2は固定順JSON配列をUTF-8化してSHA-256を取る。配列順はversion、切替ID、scope、連番、id、event_id、organization_id、actor_id、action_type、resource_type、resource_id、outcome、request_id、session_id、reason、created_at、details、ip_hash、user_agent、previous_hash。
- NULLと空文字を区別し、区切り文字・改行・UnicodeはJSONとしてescapeする。created_atはUTC固定ISO表記・小数秒6桁とし、TimeZone/DateStyleに依存させない。PostgreSQL 17の固定fixtureでcanonical bytesを保存し、DBメジャー更新時にも互換性を確認する。
- 最初のprevious_hashは切替IDとscopeを含むversion付きGENESISとする。v1の日時最大行を前hashに選ばない。外部manifestでv1 inventoryとv2開始条件を関連付ける。
- headとrun snapshot等の内部tableはRLS有効、一般ロールのDML不可。新規table/functionのGRANT/REVOKEを明示する。公開RPCは固定search_path・引数上限を持ち、一般ロールからのEXECUTEを拒否する。permissions.tsの業務権限は変更しないが、RLSとの整合は照合して報告する。

### 3.2 v1を維持した切替手順

1. 新規migrationでv2書込へ原子的に切り替え、切替IDと境界を記録する。既存行・hash・versionは維持し、以降v1行を追加させない。
2. 固定されたv1全行を、NULL hash・組織なしを含めinventory化する。既存外部objectの全generationも照合し、不足・重複・差異を列挙する。v2の書込は継続できる。
3. v1のhash再計算には保存されたprevious_hashを使い、参照切れ・分岐・複数GENESIS・NULL・循環を別分類で報告する。日時で並び替えて正常化しない。TimeZone/DateStyleの候補は運用証跡で確認できる設定に限定し、再現不能を推測で合格させない。
4. 外部manifestに切替ID、v1全行digest・件数・scope別inventory・異常一覧、v2開始条件、検証版を記録し、objectのgenerationとSHA-256をreceiptへ固定する。
5. 初回基準点は取得時点からの比較の起点であり、それ以前の無改ざんを遡及証明しない。既存証跡で裏付けられない過去やv1異常は未解決とし、baseline保存だけで全体を合格にしない。

v1の不整合が実DBで見つかった場合は元データを保全し、事実と提供判定への影響を報告する。自動修復・既存行の再hash・新たなrisk受容はしない。

## 4. 外部保管・checkpointの設計

### 4.1 保存先と不変性

- 正本は環境ごとに指定する10年間保持の監査専用bucket。既存7年bucketのobject・retention・lockを維持し、削除・保持短縮を行わない。実bucketとの照合前に切替済みと記載しない。
- 新規objectはcreate-only（`ifGenerationMatch=0`）、内容hashを含むobject名とgeneration指定読出しを使う。保存後のgeneration・size・digestを検証してreceiptを作る。同じbatch IDの再送は同一内容なら再利用し、別内容なら上書きせず停止する。
- writerはobject作成、verifierは必要prefixの読取と結果receipt作成に限定し、削除・上書き・bucket設定変更を許さない。GitHubからは既存backup同様WIF/OIDCを使い、環境別IAMを実確認する。
- lock未設定なら管理者による変更不能とは扱わない。不可逆なBucket Lock適用はsaved planと影響を示し、実施時に別途承認を得る。本設計作業では設定を変更しない。
- HMAC受信先は署名検証・永続化・重複排除・保持・独立したreceiptを確認できるまで、単独で不変checkpointの代替にしない。

### 4.2 完全性と鮮度

- immutable manifestに環境、schema/chain version、batch ID、切替ID、scope別開始/終了連番・件数・head hash、event IDと各行digestのinventory、object名/generation/SHA-256、直前manifestのdigestを持たせる。識別子は非公開object内に限定する。
- inventoryの行digestにもversion付きcanonical化を定義する。既知の全列を固定順配列にし、timestampはUTC固定表記、NULLと空文字を区別する。出力UTF-8 bytes自体を保存・hash化し、workerがJSONを再serializeして比較しない。schema追加時はinventory versionも上げる。
- DB checkpointは再送用の進捗キャッシュ。外部receiptの保存・検証後に進める。receipt欠落、checkpointの巻戻し・不正前進、manifest分岐も非成功にする。
- v2は`(scope, sequence)`のkeysetで未保存範囲を反復する。500件を1回取得して日次処理を終えない。scopeのcommit済みheadを上限にし、未完了・backlog・予算切れを明示する。v1は固定inventoryを全量処理する。
- scope一覧も外部保存する。検証対象は外部とDBのscopeの和集合とし、DBからscope全体や末尾が消えても検知する。
- 新規監視の初期設計値は完全アーカイブ26時間超、週次検証成功8日超でCritical。成功履歴がない環境も監視開始時から計時する。既存DB backupの閾値は変更しない。workflow未実行を検知する別系統の定期監視を接続する。
- 保存済み上限までDB・外部の全行を照合する。それより新しいv2行は内部検証し、外部照合待ちを区別する。末尾削除・全体再生成の保証範囲は最後の独立保存checkpointまでであり、その後の未保存分の削除を必ず検知できるとは主張しない。
- 独立性の前提は、DBデータを書き換える主体が外部receipt/objectや検証コードを同時に書き換えられないこと。DB・アプリ・GCS管理権限の同時侵害まで検知を保証しない。IAM分離と実際の保持設定の証跡を必要とする。

## 5. 週次検証の実行契約と検証計画

- GitHub Actionsで週次と手動実行を用意し、手動の既定はStaging。同一環境は`cancel-in-progress: false`で直列化する。予定未実行を週次workflow自身だけに監視させない。
- 外部receipt系列・generation・manifest連続性を先に確認する。DB内の最新ポインタだけを信じない。結果receiptへrun URL、環境、検証版、対象manifest、合否を記録する。
- APIは固定HTTPS origin、redirect禁止、CRON_SECRET必須。queryに資格情報を置かず、認証失敗・環境不一致では読出しを開始しない。旧`curl --location`とresponse全文出力は採用しない。
- 開始RPCで同一DB snapshotのscope一覧とheadをrun snapshotへ固定し、run IDでページ取得する。途中の新規書込を検証対象へ混ぜない。内部snapshot tableは一般ロールから隠し、自動物理削除は追加しない。その増加量も容量試験に含める。
- 初期予算は500行かつ1MiB/response、SQL 10秒/API 30秒、workflow全体30分。1行で上限を超える場合も飛ばさず検証不能にする。これらは実測前の上限値であり、合成データで確認・調整する。
- DBのversion別canonical bytesと保存hashをworkerへ渡し、worker側でもSHA-256・連番・前hashを検算する。外部inventoryはraw行全体のdigestも保存し、v1のhash対象外列も基準点以降は比較する。
- 空配列/NULL fallbackや一部ページの成功で全体成功にしない。全scope・全ページ・v1判定・外部照合・結果receipt保存を終えた場合のみ成功。途中終了はincomplete、基盤障害はunavailable、整合不一致はmismatchとして区別し、いずれも非成功とする。
- 通知はCritical、環境、固定分類、Actions runのリンクのみ。組織/event ID、canonical bytes、reason、details、tokenを通知・通常ログ・Actions artifactへ出さない。通知自体が失敗してもjobを成功にしない。
- service roleは既存`serviceRoleForAuditPreservation`の用途拡張とし、RPC/APIと台帳を同時更新。PUBLIC/anon/authenticatedからの検証RPC実行不可を実DBで確認する。super-admin向けUIには公開しない。
- fail-closedは検証を成功扱いしないこと。検証基盤障害だけで通常業務を一律停止する新機能は追加しない。改ざん時の停止・事故対応は承認済み方針と既存手順へ接続する。

| 分類 | 追加予定のfixture/操作 | 期待結果 |
|---|---|---|
| 正常 | 空DB、複数組織、global、NULL/空文字/改行/Unicode、別TimeZone/DateStyle | 誤報なし。空DBでもbaseline/receipt欠如は合格にしない |
| 順序 | 同時刻・逆UUID順、1transaction複数行、開始とcommit順の逆転、2接続、rollback、複数scope | v2連番が一意で連続、head一致、分岐なし |
| 内部改変 | 1列変更、NULL hash、不正version、前hash変更、重複連番、中間欠落、分岐、global改変 | 固定分類で検知 |
| 外部照合 | 保存済み末尾削除、scope全削除、DB全体再生成、head/checkpoint同時書換え | 外部inventory/receiptとの不一致を検知 |
| 保管異常 | object欠落・別generation・digest不一致、manifest分岐、同名別内容、receipt保存失敗、再送 | 非成功。外部保全確認前にcheckpointを進めない |
| 遅延・負荷 | 500件超、同時刻501件超、遅いcommit、監査10万件・複数scope、継続追記 | 取りこぼし・無限再送なし。超過はincomplete。時間/lock/容量を記録 |
| 認証・秘匿 | secret欠落/不正、別環境、redirect、一般ロールRPC直呼び、例外に識別子混入 | 拒否・非露出、secretを別originへ転送しない |
| 通知・監視 | 不一致、DB/GCS timeout、通知失敗、schedule未実行、成功履歴なし | 合成データで通知・監視経路を確認。未実行を正常扱いしない |

改変は使い捨てローカルDB・合成データ・試験専用fixtureでのみ行う。特権でtriggerを迂回する試験用操作をアプリや運用ツールへ追加しない。本番監査行を改変しない。

## 6. 認可テストの対応表

「既存」はソース確認であり、今回の実行結果ではない。mock unit・実DB・E2Eを同等扱いしない。管理者は固定role名で推定せず、permissions.tsの実効権限を使う。

| ケース | 既存の証拠と限界 | 追加する検証 |
|---|---|---|
| 未ログイン・失効・所属なし | `src/utils/supabase/authResults.test.ts`はabsent session、失効相当の空行、所属なし、DB障害の分類とfilterをmock検証 | 実DBでrevoked_at、24h無操作、30日絶対期限、JWT session_id不一致を個別に作り、SELECT/主要RPCを拒否 |
| 利用者Action | clients専用Action testは見当たらない。`actionResults.test.ts`はserviceTypes/staffRoles等でclientsを検証しない。`tests/admin-features.spec.ts`はUI正常系 | create/rename/archive/restore/softDelete/form/assignments/googleLink/permissionHintsの全公開Actionで認可拒否・副作用なし。変更系は許可・他組織・削除済み・不存在も試す |
| 組織境界 | `supabase/tests/security_hardening.test.sql`は非所属clients SELECT/INSERT拒否とowner INSERT RETURNING。`tests/tenant-isolation.spec.ts`は他組織URLで利用者名非表示 | 同組織の無権限member、他組織owner、組織ID/対象ID偽装。DBの0行・RPC拒否・ActionResult分類を個別確認 |
| 担当/未担当 | `src/utils/permissions.test.ts`はall/assigned/noneの純関数。security_hardeningはpolicy式の一部。shift_business_notifications DB testは無権限/他組織の編集拒否 | 実assignments/staffでrecords/shiftsのview/create/edit/deleteを比較。all対照、assigned本人許可、未担当・混在ID・担当解除後拒否。clients管理にassigned scopeを新設しない |
| super-admin | `src/app/actions/super-admin.ts`はassertSuperAdmin、組織情報/集計のみ、削除拒否。専用Action testは見当たらない | 未ログイン/一般/member/owner拒否、正規super-admin許可、問い合わせ先/取得列/返却値の許可リスト、削除拒否unit。所属・業務権限のないsuper-adminの記録/画像直接DB/RPC取得拒否 |
| 退会・除名・権限剥奪 | accounts.testは除名認可、accountSecurity.testは他session失効、organization_owner_add DB testは最後のowner保護。現行退会RPCはprofiles.deleted_at設定・所属解除、ActionはAuth ban | 退会後の古いJWT、除名後、ロール剥奪後の読取/更新を実DBで拒否し、許可対照も作る。is_active列の不在を未対応の理由にしない |
| owner・危険権限 | roles.test、roleSafety.test、accounts.test、rpc_contracts DB test、organization_owner_add DB testに既存ケース | 既存検証を再利用。全ロール/経路の網羅とはせず、上記不足との交差だけ追加 |
| 監査失敗・版履歴 | `record_version_invariants.test.sql`はrecord_versionsの連鎖と監査失敗rollback | audit_events自体の連鎖検証とは区別。v2導入後も既存原子的処理のrollbackを再実行 |
| UI/REST/RPC/署名URL | tenant-isolation E2Eは画面非表示の一例。super-admin/署名URLを含む経路横断の専用拒否試験は今回の探索では見当たらない | 同fixtureでREST/RPC直呼び、Storage署名URLの発行/取得拒否を確認。未発行URLの拒否と発行済みURLの有効期間は区別 |

unitは現行withActionResult契約の`ok: false`とerror codeを検証し、旧案のrejects.toThrowを流用しない。guardをmockして拒否する試験を、guard内部やRLSの証明にしない。

参照: [認証unit](../src/utils/supabase/authResults.test.ts)、[権限unit](../src/utils/permissions.test.ts)、[DB安全性](../supabase/tests/security_hardening.test.sql)、[RPC契約](../supabase/tests/rpc_contracts.test.sql)、[組織分離E2E](../tests/tenant-isolation.spec.ts)。

## 7. 後続Issueの分割案と実施順

以下は本書内の草案IDであり、GitHub Issue番号ではない。今回、自動実装キューには追加しない。

| 草案 | 1責務・成果物 | 依存・受入条件 |
|---|---|---|
| A: 監査v2の書込整合性 | 追加migration、canonical関数、transactional head/連番、v1切替境界 | 最初。既存行不変のupgrade、空DB再構築、2接続の陽性/陰性。permissions/RLS整合とACLを報告 |
| B: アーカイブの完全性 | 環境別保存先、v1 baseline、連番ページング、create-only manifest/receipt、鮮度監視 | A依存。500件超/遅延commit/再送/欠落/設定不備。実bucket変更は別途計画・承認 |
| C: 週次検証 | bounded RPC/APIとrun snapshot、workflow、外部照合、秘匿通知、未実行監視 | A/B依存。§5全分類、無権限拒否、台帳、10万件の時間/lock/容量実測 |
| D: 利用者Action認可回帰 | 全公開Actionのunitと関連DB境界試験 | A/Bと独立。許可対照・偽装・別組織・削除済み・副作用なし・ActionResult |
| E: super-admin情報境界回帰 | metadata許可リスト/削除拒否unit、顧客記録/ファイル拒否DB試験 | Dと別責務。実在する取得経路を検索し、単一Action正常系だけで完了にしない |
| F: session・担当scopeの直接アクセス回帰 | 失効/退会/除名/剥奪、assignedの実DB・REST/RPC/Storage経路表 | 既存ケースを再利用。認可の不整合が見つかれば修正Issueを分ける |

各実装は着手時の最新origin/mainから専用branch/PRを作る。[testing.md](testing.md)に従い、DB変更は空DB・upgrade・関連pgTAP・security_hardening・unit、アプリ変更はtypecheck/lint、リリース相当はbuildを実施。E2Eはユーザー確認後。

配備は後方互換schemaをStaging→Productionへ手動適用し、旧アプリの監査INSERTもv2 triggerで成立させる。migration history・dry-run・backup freshnessを確認してからアプリ切替。初回baseline/検証はStaging合成データで試す。Productionは承認範囲内の読取と新規証跡作成のみとする。

rollbackでschemaを戻してv1書込を再開しない。失敗時は新検証workflowを停止し、v2書込と保全を維持して追加migrationで前進修正する。書込が失敗する場合も監査を迂回するfallbackは作らない。

## 8. 完了条件と未確認事項

本書で正本・順序・正規化・v1互換・外部checkpoint・テスト対応表・後続責務を定義した。実データのv1異常、実bucket/lock/IAM、負荷予算、HMAC受信先の保証は未確認として後続の実測条件に残す。未確認をaccepted-riskや合格へ読み替えない。

#101は設計レビューと後続Issueの登録・関連付け後に設計Issueとして完了可能。今回の文書作成だけではcloseしない。週次検証の運用完了はCの配備・正常/改ざん通知・未実行監視の証跡が揃った時点。release checklist/control-matrixはその証跡まで未完了を維持する。

### 一次ドキュメント確認

2026-10-24、Context7で確認。対象DBはsupabase/config.tomlのPostgreSQL 17、Storage SDKはrepositoryの7系。Context7のSDK資料はmainを含むため実装時は固定依存版でも確認する。

- PostgreSQL 17: [日時出力とTimeZone](https://www.postgresql.org/docs/17/datatype-datetime.html)、[transaction時刻](https://www.postgresql.org/docs/17/functions-datetime.html)、[transaction advisory lock](https://www.postgresql.org/docs/17/explicit-locking.html)、[sequenceはrollbackされない](https://www.postgresql.org/docs/17/sql-createsequence.html)。
- Google Cloud Storage Node.js SDK: [FileのpreconditionOpts/ifGenerationMatch](https://github.com/googleapis/nodejs-storage/blob/main/src/file.ts)。実bucketのlock状態は配備時の設定証跡で確認する。
