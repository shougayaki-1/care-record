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
- BEFORE INSERTだけでheadを進めて完了にしない。ON CONFLICT DO NOTHINGや後続triggerによる行スキップでも、head変更だけがcommitされないことをDB制約で保証する。設計はheadの各採番更新に対する遅延constraint triggerとし、その連番・hashのイベントが存在することをcommit時に検査する。存在しなければtransaction全体を拒否する。複数行中1行だけの競合も試す。AFTER ROWだけで採番する代替は、複数行INSERTのBEFORE処理との整合を実証せず採用しない。
- 分離レベルを明示する。Read Committedではロック取得後の最新headを使い、Repeatable Read/Serializableの40001やdeadlockの40P01では部分的に再試行せずtransaction全体をrollbackする。業務RPCの再送は既存の冪等性契約で行い、外部送信済み処理を無条件に再実行しない。
- commit済みv2連番はscopeごとに1から連続する。同一transaction複数行、2接続同時実行、逆のcommit順、rollback、新規scopeの同時生成で確認する。複数scopeのlock順とdeadlock時のrollbackも試す。
- audit_eventsにはnullableなv2連番等を追加し、既存行をUPDATEしない。準備migrationではv1書込を維持し、切替migrationで初めてversionのdefaultを2に変更する。新triggerはversion=2、連番、前hashを決定して任意値の持込やv1へのdowngradeを拒否する。旧アプリがversionを省略するINSERTも受け付ける。scope/連番の重複を制約で拒否する。
- 正規化はversion別DB関数を正本とする。v2は固定順JSON配列をUTF-8化してSHA-256を取る。配列順はversion、切替ID、scope、連番、id、event_id、organization_id、actor_id、action_type、resource_type、resource_id、outcome、request_id、session_id、reason、created_at、details、ip_hash、user_agent、previous_hash。
- NULLと空文字を区別し、区切り文字・改行・UnicodeはJSONとしてescapeする。created_atはUTC固定ISO表記・小数秒6桁とし、TimeZone/DateStyleに依存させない。PostgreSQL 17の固定fixtureでcanonical bytesを保存し、DBメジャー更新時にも互換性を確認する。
- 最初のprevious_hashは切替IDとscopeを含むversion付きGENESISとする。v1の日時最大行を前hashに選ばない。外部manifestでv1 inventoryとv2開始条件を関連付ける。
- headとrun snapshot等の内部tableはRLS有効、一般ロールのDML不可。新規table/functionのGRANT/REVOKEを明示する。公開RPCは固定search_path・引数上限を持ち、一般ロールからのEXECUTEを拒否する。permissions.tsの業務権限は変更しないが、RLSとの整合は照合して報告する。

### 3.2 v1を維持した切替手順

1. Aの後方互換な準備schemaと、Bのv1/v2双方を読めるアーカイブ処理を先に配備する。この段階はv1書込を維持し、v2の存在を前提とするjobを有効にしない。Stagingで旧/新アプリと旧/新schemaの組合せを確認する。
2. Gの切替migrationでv2書込へ原子的に切り替え、切替IDと境界を記録する。監査tableへの書込と競合するtable lockを取得し、既に挿入中のtransactionの完了を待ってからtrigger/defaultを変更する。lock_timeout内に取得できなければ全変更をrollbackし、部分切替しない。切替待ち・開始済みtransactionの挿入が境界を越えてもv1を追加しないことを2接続試験で確認する。既存行・hash・versionは維持する。
3. 固定されたv1全行を、NULL hash・組織なしを含めinventory化する。既存外部objectの全generationも照合し、不足・重複・差異を列挙する。v2の書込は継続できる。
4. v1のhash再計算には保存されたprevious_hashを使い、参照切れ・分岐・複数GENESIS・NULL・循環を別分類で報告する。日時で並び替えて正常化しない。TimeZone/DateStyleの候補は運用証跡で確認できる設定に限定し、再現不能を推測で合格させない。
5. 外部manifestに切替ID、v1全行digest・件数・scope別inventory・異常一覧、v2開始条件、検証版を記録し、objectのgenerationとSHA-256をreceiptへ固定する。
6. 初回基準点は取得時点からの比較の起点であり、それ以前の無改ざんを遡及証明しない。既存証跡で裏付けられない過去やv1異常は未解決とし、baseline保存だけで全体を合格にしない。

v1の不整合が実DBで見つかった場合は元データを保全し、事実と提供判定への影響を報告する。自動修復・既存行の再hash・新たなrisk受容はしない。

## 4. 外部保管・checkpointの設計

### 4.1 保存先と不変性

- 正本は環境ごとに指定する10年間保持の監査専用bucket。既存7年bucketのobject・retention・lockを維持し、削除・保持短縮を行わない。実bucketとの照合前に切替済みと記載しない。
- 新規objectはcreate-only（`ifGenerationMatch=0`）とgeneration指定読出しを使う。chunk名には内容hashを含め、manifest名は§4.2の固定ordinalにする。保存後のgeneration・size・digestを検証する。同じchunk/batch IDの再送は同一内容なら再利用し、別内容なら上書きせず停止する。manifestの競合は§4.2で勝者を照合する。
- 信頼の起点は、Gで運用者が確認・発行するcontrol manifestのobject名/generation/digestと切替IDを、DBとは独立した環境設定へ固定する。archive writer/verifierはcontrol prefixを読めるが発行できない。DBやwriterが新たな切替ID/GENESISを提示しても自動採用せず拒否する。復元・正当な再切替も前のcontrol manifestを参照する承認済み更新を必要とし、勝手に別系列のordinal=1から再開させない。
- archive writerには対象prefixへの作成と、同名再送の照合に必要な読取を許可する。verifierはarchive prefixの読取とverification専用prefixへの結果作成に限定し、archive manifestを発行できないようにする。双方とも削除・上書き・bucket設定変更を許さない。objectCreatorだけでは再送時の既存object照合はできないため、必要なget/listも用途別に確認する。GitHubからは既存backup同様WIF/OIDCを使い、環境別IAMを実確認する。
- lock未設定なら管理者による変更不能とは扱わない。不可逆なBucket Lock適用はsaved planと影響を示し、実施時に別途承認を得る。本設計作業では設定を変更しない。
- HMAC受信先は署名検証・永続化・重複排除・保持・独立したreceiptを確認できるまで、単独で不変checkpointの代替にしない。

### 4.2 完全性と鮮度

- immutable manifestに環境、schema/chain version、batch ID、切替ID、scope別開始/終了連番・件数・head hash、event IDと各行digestのinventory、object名/generation/SHA-256、直前manifestのdigestを持たせる。識別子は非公開object内に限定する。
- inventoryの行digestにもversion付きcanonical化を定義する。行schema versionごとの保護対象全列を固定順配列にし、timestampはUTC固定表記、NULLと空文字を区別する。出力UTF-8 bytes自体を保存・hash化し、workerがJSONを再serializeして比較しない。schema追加時はinventory versionも上げる。既存exportとの照合は当時のschemaに存在する列を使い、新設列の不在と当時からある列の欠落を区別する。旧exportに記録されていない列の一致は証明済みにしない。
- 外部系列はarchive manifestとverification結果を別prefixに分離する。archive manifestは環境・切替IDごとに1から連続するordinalを持ち、object名は内容hashだけでなく`archive/<environment>/<cutover-id>/manifests/<ordinal>.json`へ固定する。各manifestが直前digestとchunkの内容hashを持ち、そのobjectをcreate-onlyで発行することをbatch commit点とする。
- scheduled/manual/API再送を含むpublisher同士は同じ次ordinalへ競合させる。先にchunkを保存し、最後に固定名manifestを発行する。HTTP 412/応答喪失では既存manifestをgeneration指定で読み、同一内容だけを再利用する。別内容なら勝者を検証して未保存範囲から再計画し、敗者のchunkを正式な系列へ追加しない。孤立chunkは成功件数に数えず、自動物理削除しない。
- manifest自体が転送成功receiptを兼ねる。DB checkpointは再送用の進捗キャッシュであり、manifest保存・検証後に進める。保存後にDB更新だけ失敗した場合は、外部の連続系列から進捗を再構築して再送する。receipt欠落、checkpointの不正前進、manifest分岐は非成功にし、復旧前の巻戻しを正常転送と誤認しない。
- v2は`(scope, sequence)`のkeysetで未保存範囲を反復する。500件を1回取得して日次処理を終えない。各run開始時に一度だけscope一覧とcommit済みheadを同じsnapshotから固定し、途中で上限を伸ばさない。処理自身のaudit.archiveイベントを同runで追い続けない。未完了・backlog・予算切れを明示し、v1は固定inventoryを全量処理する。
- scope一覧も外部保存する。検証対象は外部とDBのscopeの和集合とし、DBからscope全体や末尾が消えても検知する。
- 新規監視の初期設計値は完全アーカイブ26時間超、週次検証成功8日超でCritical。成功履歴がない環境も監視開始時から計時する。既存DB backupの閾値は変更しない。workflow未実行を検知する別系統の定期監視を接続する。
- 保存済み上限までDB・外部の全行を照合する。それより新しいv2行は内部検証し、外部照合待ちを区別する。末尾削除・全体再生成の保証範囲は最後の独立保存checkpointまでであり、その後の未保存分の削除を必ず検知できるとは主張しない。
- 独立性の前提は、DBデータを書き換える主体が外部receipt/objectや検証コードを同時に書き換えられないこと。DB・アプリ・GCS管理権限の同時侵害まで検知を保証しない。IAM分離と実際の保持設定の証跡を必要とする。

## 5. 週次検証の実行契約と検証計画

- GitHub Actionsで週次と手動実行を用意し、手動の既定はStaging。同一環境は`cancel-in-progress: false`で直列化する。予定未実行を週次workflow自身だけに監視させない。
- 外部receipt系列・generation・manifest連続性を先に確認する。DB内の最新ポインタだけを信じない。結果receiptへrun URL、環境、検証版、対象manifest、合否を記録する。
- APIは固定HTTPS origin、redirect禁止、CRON_SECRET必須。queryに資格情報を置かず、認証失敗・環境不一致では読出しを開始しない。旧`curl --location`とresponse全文出力は採用しない。成功・失敗ともAPI responseはprivate, no-storeとし、CDNやbrowser cacheへ監査内容を保存させない。
- 開始RPCの単一INSERT SELECT文でscope一覧とheadを同一DB snapshotからrun snapshotへ固定し、run IDでページ取得する。途中の新規書込を検証対象へ混ぜない。内部snapshot tableは一般ロールから隠し、自動物理削除は追加しない。その増加量も容量試験に含める。
- 初期予算は500行かつ1MiB/response、SQL 10秒/API 30秒、workflow全体30分。1行で上限を超える場合も飛ばさず検証不能にする。これらは実測前の上限値であり、合成データで確認・調整する。
- DBのversion別canonical bytesをbase64等の可逆表現で、保存hashとともにworkerへ渡す。workerは復元したbytesでSHA-256・連番・前hashを検算する。連番・件数・GCS generationは10進文字列として渡し、比較/加算にJavaScript Numberを使わない。日時をDateへ変換してマイクロ秒を失う再hashもしない。1MiB上限はbase64/JSONの増加分を含むHTTP response全体へ適用する。ページcursorは最後に実際に返した行から作り、byte上限で未返却の行を飛ばさない。外部inventoryはraw行全体のdigestも保存し、v1のhash対象外列も基準点以降は比較する。
- 空配列/NULL fallbackや一部ページの成功で全体成功にしない。全scope・全ページ・v1判定・外部照合・結果receipt保存を終えた場合のみ成功。途中終了はincomplete、基盤障害はunavailable、整合不一致はmismatchとして区別し、いずれも非成功とする。
- 通知はCritical、環境、固定分類、Actions runのリンクのみ。組織/event ID、canonical bytes、reason、details、tokenを通知・通常ログ・Actions artifactへ出さない。通知自体が失敗してもjobを成功にしない。
- service roleは既存`serviceRoleForAuditPreservation`の用途拡張とし、RPC/APIと台帳を同時更新。PUBLIC/anon/authenticatedからの検証RPC実行不可を実DBで確認する。super-admin向けUIには公開しない。
- fail-closedは検証を成功扱いしないこと。検証基盤障害だけで通常業務を一律停止する新機能は追加しない。改ざん時の停止・事故対応は承認済み方針と既存手順へ接続する。

| 分類 | 追加予定のfixture/操作 | 期待結果 |
|---|---|---|
| 正常 | 空DB、複数組織、global、NULL/空文字/改行/Unicode、別TimeZone/DateStyle | 誤報なし。空DBでもbaseline/receipt欠如は合格にしない |
| 順序・commit | 同時刻・逆UUID順、複数行INSERT、一部DO NOTHING/trigger skip、逆commit順、2接続、rollback、複数scope、40001/40P01 | headだけのcommit・欠番・分岐なし。再試行はtransaction全体 |
| 切替 | Aのみ、B先行配備、長時間transactionとGのDDL競合、lock timeout、切替後の旧アプリ | 準備段階はv1を維持。部分切替なし。境界後v1追加なし。旧アプリINSERTは成立 |
| 内部改変 | 1列変更、NULL hash、不正version、前hash変更、重複連番、中間欠落、分岐、global改変 | 固定分類で検知 |
| 外部照合 | 保存済み末尾削除、scope全削除、DB全体再生成、head/checkpoint同時書換え | 外部inventory/receiptとの不一致を検知 |
| 保管異常・並行発行 | object欠落・別generation・digest不一致、同じordinalへ2publisher、未承認の切替ID/GENESIS、発行応答喪失、manifest保存後DB更新失敗、孤立chunk | 正式系列は1本。競合を再照合し、外部保全確認前にcheckpointを進めない |
| 復元・精度 | 古いDB/headを復元、2^53超の連番/generation、マイクロ秒日時、response byte上限の直前直後 | staleなheadを外部基準へ上書きしない。精度欠落・ページ飛越なし。復元後の再開は§7の照合後 |
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
| 担当/未担当 | `src/utils/permissions.test.ts`はall/assigned/noneの純関数。security_hardeningはpolicy式の一部。shift_business_notifications DB testは無権限/他組織の編集拒否 | 実assignments/staffでrecordsのview/create/edit/delete/approve、shiftsのview/create/edit/delete、internalWorkのview/createを現行権限に従って比較。all対照、assigned本人許可、未担当・混在ID・担当解除後拒否。clients管理にassigned scopeを新設しない |
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
| A: 監査v2の書込準備 | 後方互換migration、canonical関数、transactional head/連番とcommit整合性。v1書込は維持 | 最初。既存行不変のupgrade、空DB再構築、競合skip/分離レベル/2接続。permissions/RLS整合とACLを報告 |
| B: アーカイブの完全性 | 環境別保存先、v1/v2読出し、連番ページング、単一publisher系列とreceipt、鮮度監視 | A依存。G前に配備。v1 baselineの生成手段を用意し、切替前は未確定扱い。並行発行/応答喪失/500件超を検証。実bucket変更は別途計画・承認 |
| G: 既存監査を保全したv2切替 | 新規の切替migration、v1固定inventory/baseline、旧jobとの切替手順・実施証跡 | A/B配備と非本番互換試験が前提。DDL待機、旧job drain、境界、外部baselineを確認。Production適用は承認範囲で手動実施 |
| C: 週次検証 | bounded RPC/APIとrun snapshot、workflow、外部照合、秘匿通知、未実行監視 | A/B/G依存。§5全分類、無権限拒否、台帳、10万件の時間/lock/容量実測 |
| D: 利用者Action認可回帰 | 全公開Actionのunitと関連DB境界試験 | A/Bと独立。許可対照・偽装・別組織・削除済み・副作用なし・ActionResult |
| E: super-admin情報境界回帰 | metadata許可リスト/削除拒否unit、顧客記録/ファイル拒否DB試験 | Dと別責務。実在する取得経路を検索し、単一Action正常系だけで完了にしない |
| F: session・担当scopeの直接アクセス回帰 | 失効/退会/除名/剥奪、assignedの実DB・REST/RPC/Storage経路表 | 既存ケースを再利用。認可の不整合が見つかれば修正Issueを分ける |

各実装は着手時の最新origin/mainから専用branch/PRを作る。[testing.md](testing.md)に従い、DB変更は空DB・upgrade・関連pgTAP・security_hardening・unit、アプリ変更はtypecheck/lint、リリース相当はbuildを実施。E2Eはユーザー確認後。

配備順はAの準備schema→Bのdual読出し配備→Gの切替→Cの週次有効化。各schema変更をStaging→Productionへ手動適用し、migration history・dry-run・backup freshnessを確認する。GはBの配備済みversionを照合し、旧アーカイブjobの起動停止とin-flight完了を計画・承認範囲で確認してから実行する。旧checkpointをv2へ流用しない。baselineの全量保存・照合後に新アーカイブを有効にし、成功前は移行未完了を明示する。G失敗時も旧jobへ無条件に戻さず、v1/v2双方を保存できるBで保全を続ける。

初回baseline/検証はStaging合成データで試す。ProductionのGは新規migration適用と新規証跡作成を伴うため、影響・lock待機・中断条件を提示して手動適用する。通常検証は読取と新規結果作成に限定する。

DB復元時は、外部の最新切替ID・ordinal・scope別headと復元DBを先に照合する。古いheadから同じ連番を再採番する再開や、新baselineへの自動リセットを禁止する。外部から監査イベント/headを整合復旧できない場合は欠落範囲を事故証跡に残し、再開方法を別途承認する。古いDBに合わせて外部receiptを削除・巻戻ししない。

rollbackでschemaを戻してv1書込を再開しない。失敗時は新検証workflowを停止し、v2書込と保全を維持して追加migrationで前進修正する。書込が失敗する場合も監査を迂回するfallbackは作らない。

## 8. 完了条件と未確認事項

本書で正本・順序・正規化・v1互換・外部checkpoint・テスト対応表・後続責務を定義した。実データのv1異常、実bucket/lock/IAM、負荷予算、HMAC受信先の保証は未確認として後続の実測条件に残す。未確認をaccepted-riskや合格へ読み替えない。

#101は設計レビューと後続Issueの登録・関連付け後に設計Issueとして完了可能。今回の文書作成だけではcloseしない。週次検証の運用完了はCの配備・正常/改ざん通知・未実行監視の証跡が揃った時点。release checklist/control-matrixはその証跡まで未完了を維持する。

## 9. PR #148の自己レビュー記録

2026-10-24、commit `641397a`の設計を現行コードと一次資料へ照合し、以下を修正した。脆弱性スキャンや実DBでの実証ではなく、設計上の条件を検討した結果である。

| 指摘 | 修正と確認条件 |
|---|---|
| R1: BEFORE挿入後に行がスキップされるとheadだけ進む可能性 | 各採番のcommit時整合制約と、DO NOTHING/trigger skip/分離レベルの実DB試験を必須化 |
| R2: 内容hash名だけではpublisherの同時実行でmanifestが分岐する | 固定ordinal名のcreate-only発行をcommit点にし、archive/verification/controlのprefix・IAMを分離し、信頼する起点をDB外に固定 |
| R3: A先行で即切替すると、B未配備の旧アーカイブに新形式を処理させる | Aを準備に限定し、A→B→G→Cの順序と切替専用Issue、DDL境界・旧job drainを追加 |
| R4: bigint/日時やbyte上限の扱いが曖昧で誤検知・ページ欠落を起こし得る | 10進文字列/canonical bytesの可逆転送、response全体の上限、返却済みcursorを明記 |
| R5: 認可表にrecords.approve/internalWorkの担当scopeがない | 現行permissions.tsに存在する操作を表へ追加。新たな権限は作らない |

これらの設計上の抜けは修正済み。実装受入条件の成功、運用上の独立性、移行・復元の実動作は後続Issueで検証する。自己レビューを実装承認やProduction変更の承認と扱わない。

### 一次ドキュメント確認

2026-10-24、Context7で確認。対象DBはsupabase/config.tomlのPostgreSQL 17、Storage SDKはrepositoryの7系。Context7のSDK資料はmainを含むため実装時は固定依存版でも確認する。

- PostgreSQL 17: [日時出力とTimeZone](https://www.postgresql.org/docs/17/datatype-datetime.html)、[transaction時刻](https://www.postgresql.org/docs/17/functions-datetime.html)、[transaction advisory lock](https://www.postgresql.org/docs/17/explicit-locking.html)、[sequenceはrollbackされない](https://www.postgresql.org/docs/17/sql-createsequence.html)。
- PostgreSQL 17（自己レビュー追加）: [BEFORE/遅延constraint trigger](https://www.postgresql.org/docs/17/sql-createtrigger.html)、[ON CONFLICT](https://www.postgresql.org/docs/17/sql-insert.html)、[分離レベルとtransaction再試行](https://www.postgresql.org/docs/17/transaction-iso.html)。
- Google Cloud Storage Node.js SDK: [FileのpreconditionOpts/ifGenerationMatch](https://github.com/googleapis/nodejs-storage/blob/main/src/file.ts)。実bucketのlock状態は配備時の設定証跡で確認する。

- Google Cloud Storage IAM（自己レビュー追加）: [Object Creator/Viewerの権限](https://docs.cloud.google.com/storage/docs/access-control/iam-roles)。2026-10-24に公式資料で確認。create-onlyの役割だけでは既存object読取はできないため、照合に必要なget/listを分離して設計する。
