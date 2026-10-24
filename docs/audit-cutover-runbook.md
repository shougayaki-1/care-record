# 監査 v2 切替手順（Issue #151 / G）

状態: **準備文書。切替 migration・分類ツールは未実装、環境への適用・切替試験は未実施**。
2026-10-25時点の基点は `origin/main @ d20a3f2e1151f6369f2ea3b40d7aeb97ee6b884a`。
#149 / PR #156（A）、#150 / PR #157（B）は未統合であり、main上に準備schemaとdual読出しがない。
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
Bを再開する条件・設定・担当者も停止前に決め、無計画な監査保全の空白を作らない。

Gの追加migrationに実装するtransactionの契約:

1. transaction内の `SET LOCAL lock_timeout` とstatement timeoutを設定し、`audit_events`へのINSERTと競合するtable lockを取得する。lock待機中の業務書込への影響も監視する。
2. 既にINSERTしたtransactionの終了を待った後、承認済み切替UUIDを使い、Aのv2 trigger接続とversion defaultを同一transactionで変更する。旧triggerとの二重接続を残さない。
3. 前提schema・trigger/default・既存headが想定外なら拒否する。切替UUIDをその場で自動生成したり、既存scopeをGENESISへ戻したりしない。
4. 切替境界・対象versionを証跡へ記録しcommitする。lock timeout/SQLエラー時は全変更をrollbackし、別接続からtrigger/defaultが切替前のままであることを検査する。
5. commit後はversion省略の旧アプリINSERTがv2になること、明示v1/任意hash・連番持込みが拒否されることを確認する。既存v1全列・hash・versionは変更しない。

migrationの自動適用経路も調べ、対象環境・切替UUID・承認が確定する前に共有DBへ適用されないようにする。
SQLの具体的な関数名・引数・固定UUIDの扱いは、A/B統合後の実装PRで確定する。
本書には未検証の実行用SQLを置かない。

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

以下は**未実施の試験計画**。単なるSQL mockやA/Bの試験結果をGの証明へ流用しない。

- 空DB/upgradeで全既存v1列・hash・version不変、RLS/ACL、旧アプリversion省略と新アプリ、v1持込み拒否を実DBで確認する。
- 2接続で、切替前にINSERT済みのtransactionによるDDL待機、切替待機中のINSERT、切替前に開始した未INSERT transactionの切替後INSERTを確認する。Read Committed/RR/Serializableで、commit成功した行はv2、拒否時は全rollbackとし、境界後のv1追加がないことを調べる。
- 別接続でlockを保持しtimeoutを実発生させ、trigger/default/切替状態が部分変更されないこと、解除後の再実行とrollbackを確認する。
- NULL/global・参照切れ・分岐・複数GENESIS・循環・不一致・再現不能の合成fixtureを分類し、未解決を維持する。
- baseline途中失敗、create-only競合/応答喪失、DB cache更新失敗、古いDBからの復元・再開拒否をStaging合成データで確認する。
- `security_hardening.test.sql`、関連pgTAP/unit、型生成差分、typecheck、警告0のlint、buildを実行する。E2Eはユーザー確認後に限る。

ローカル、Staging、Productionの結果は別欄にし、実行時刻・対象version・run URL・非公開証跡receiptを添える。
RLS/permissions変更時は双方を照合する。準拠・release checklist・週次検証Cの完了を先行更新しない。

Context7確認: 2026-10-25、Supabase公式資料のtransaction単位migration、`SET LOCAL lock_timeout`、migration history。
対象はrepository固定Supabase CLI 2.108.0 / PostgreSQL 17。取得資料はmainを含み、固定版の切替実動作は未検証。
