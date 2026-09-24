# CareRecord 実装差分・提供開始計画

最終更新: 2026-07-16

> この文書は2026-07-16時点の計画と調査結果を記録した履歴です。以下の「現状」や検査結果は、現在の状態を示すものではありません。最新の配備・CI手順は [system-decisions.md](system-decisions.md)、[deployment-runbook.md](deployment-runbook.md)、[testing.md](testing.md) を参照してください。旧 `security.yml` / `playwright.yml` の再有効化に関する項目は、統合した `ci.yml` に置き換えられました。

## 目的

[system-decisions.md](system-decisions.md) と現行実装の差分を、提供開始を阻む順に整理します。本書の`確認済み`は静的なリポジトリ確認の結果であり、本番設定や実環境の適合を意味しません。

## 現在の基準結果

| 項目 | 結果 | 備考 |
|---|---|---|
| TypeScript | 成功 | `npm run typecheck` |
| Unit test | 成功 | 19 files / 192 tests |
| lint | 失敗 | 26 errors / 3 warnings |
| UI test | 未実行 | ブラウザ前提 |
| E2E | 未実行 | 専用Supabase環境が必要 |
| DB/RLS test | 未実行 | ローカルSupabaseが必要 |
| Production build | 未実行 | 提供判定前に必須 |
| 依存脆弱性監査 | 未実行 | 提供判定前に必須 |

## Phase -1: CI復旧（2026-07-16時点の計画・現在のCI方式に置換済み）

> 以下は当時の記録です。現在は `security.yml` / `playwright.yml` を再有効化せず、変更パスに応じた実行条件と固定名 `CI` による最終判定を使います。実行条件は[testing.md](testing.md)を参照してください。

決定（2026-07-16）: lint修正とCI復旧はPhase 2ではなく最初に行う。以降のすべてのPhaseの変更をCIで守るため。

- lintの26エラー/3警告を解消する（Effect内同期state更新、宣言前参照、未使用コード）。
- `.github/workflows/security.yml`（2箇所）と`playwright.yml`（1箇所）の`if: false`を解除する。
- lint、typecheck、unitを必須checkとして有効化する。UI/E2E/DB testは環境が整い次第追加する。

## Phase 0: 破壊的事故を防ぐガード

Phase 0開始時に、MFA、パスワード、長時間セッション、Supabase Free、基盤アクセス監査、マルウェア検査のaccepted-riskを`compliance_risks`へ登録し、受容理由、代替策、承認者を設定する。再評価日・有効期限は必須項目にせず、未設定・経過だけでGo判定を拒否しない。

### P0-1 環境分離と起動時検証

現状:

- ローカルSupabaseの開発手順はあるが、Production/Stagingの強制分離と環境識別検証は確認できない。
- 解消済み（2026-07-16）: 認証基盤、browser client、middlewareからダミーfallbackを除去した。必須値欠落時はNode/Edgeともfail-closeする。

対応:

- `APP_ENV`と期待するSupabase Project ID、GCP Project/bucketをサーバー起動時に検証する。
- Production/Stagingの環境変数schemaを作り、欠落・交差接続時にfail-fastする。
- 本番データを非本番へ投入しないCI・運用ガードを追加する。

完了条件:

- Production資格情報をStagingへ設定した試験でデプロイが失敗する。
- 必須値欠落時にアプリが起動しない。

### P0-2 物理削除経路の排除

現状:

- 旧`/api/cron/purge`は`dryRun=1`がない通常Cron呼び出しで物理削除を実行していた。
- `vercel.json`に日次purgeが登録されている。

対応:

- 初期提供のCronとアプリコードは常時dry-runとし、候補件数だけを監査・通知する。
- DB行、Supabase Storage、GCSを物理削除する実行経路は初期提供コードに持たない。
- 将来有効化する場合は、承認ID、legal hold、環境フラグ、DBロックを備えた別計画とする。

完了条件:

- URLパラメータ、HTTP method、Cron、service role用のアプリコードのいずれからも物理削除できない。

### P0-3 AI機能フラグ

現状:

- AI APIと画面が存在し、Productionで強制無効にするサーバー側フラグは確認できない。

対応:

- サーバー側の`AI_IMPORT_ENABLED`を正本にし、無効時は画面非表示に加えてAPIも拒否する。

完了条件:

- 直接APIを呼んでも無効環境では処理・Vertex送信が起きない。

## Phase 1: 認証・認可

### P1-1 セッション値の統一

現状:

- クライアントとServer Actionの無操作期限は24時間だが、絶対期限は24時間。
- compliance文書には旧15分/12時間が残っていた。

対応:

- 無操作24時間、絶対30日を共有設定として一元化する。
- middleware、Server Action、クライアント警告、テストを同じ設定へ揃える。
- 重要操作の再認証証明を短時間・操作目的付きで実装する。

### P1-2 通常業務からservice roleを排除

現状（2026-07-16実装後）:

- 通常業務のAction/APIはsession client＋RLSまたは認可込み原子的RPCへ移行済み。
- Action内に残る管理クライアントのローカル変数は、Auth管理、サーバー管理セッション、バックアップ、障害修復、基盤メタデータ管理の6ファイルだけで、すべて用途別wrapper経由である。
- raw `supabaseAdmin` importは用途別wrapperだけに限定し、service role key参照箇所とallowlist外importをCIで拒否する。
- `rg supabaseAdmin`の単純件数は用途別wrapperから取得したローカル変数も数えるため、通常業務の未移行件数として扱わない。

対応:

1. 全Server Action/API/RPCを操作台帳へ列挙する。
2. セッションclient + RLSで実行できる処理へ移行する。
3. 複数更新だけを認可込みの原子的RPCへ移す。
4. service roleをログイン試行、OAuth nonce、サーバー管理セッション、Auth管理、バックアップ・復旧・画像複製、監査保全、dry-run、承認済み削除、基盤障害対応のallowlistへ限定する。
5. public/storageのRLS・GRANTカタログテストを追加する。
6. 各allowlist項目へ目的、対象、入力認可、監査を登録し、allowlist外の利用をCIで拒否する。

決定（2026-07-16）: 部分移行や完了条件の緩和は行わず、全面移行を貫く。提供開始はこの完了を待つ。

決定（2026-07-16追記）: `backup.ts`はバックアップ閲覧・生成のみで復元操作を提供しない。復元は隔離環境専用の`restore-logical-backup.sh`から実行し、Production-like URL拒否、専用環境変数、明示確認値、GitHub Environment承認で保護するため、ブラウザセッション用`backup_restore` grantの対象外とする。Google OAuth tokenの接続・再認証・切断は`external_secret_change` grantを必須とする。

完了条件:

- 通常操作のservice role呼び出しが0件で、全テナント拒否試験が通る。

### P1-3 権限モデルの拡張

現状:

- `RolePermissions.management`に独立した`backupStatus.view`がなく、バックアップ閲覧は`auditLogs`権限を流用している。

対応:

- バックアップ状況閲覧を独立権限として追加する。
- オーナー既定許可、カスタムロール追加可、復元不可をRLS、Server Action、UI、マニュアルで揃える。

### P1-4 super admin緊急アクセス（実装しないことに決定）

決定（2026-07-16）: 緊急アクセスgrant機構は実装しない。super adminのアプリ内顧客データアクセス機能自体を持たず、全経路（Server Action/API/RPC）で顧客本文・ファイル取得を拒否する。基盤調査時はアクセス前後を削除不能なGCS監査bucketへ記録する。コンソールアクセスとの強制連動はできないためaccepted-riskとする。

対応:

- super adminからの顧客本文・ファイル取得を全経路で拒否し、拒否テストを追加する。
- 基盤側アクセス前後をGCSへ追記する手順・ツールを用意する。
- accepted-riskに受容理由、代替策、承認者を登録する。

### P1-5 パスワード・招待・アカウント変更

現状:

- パスワードは8文字以上に加えて3種類以上の文字種を要求しており、確定方針と一致しない。
- 招待・メール変更・全端末失効が確定仕様をすべて満たすかはE2E未確認。

対応:

- 文字種要件を撤廃し、8文字以上だけをサーバー側正本としてUIと揃える。
- 72時間・1回限り・メール一致・再発行失効の招待試験を追加する。
- パスワード/メール変更後の他端末失効、アカウント列挙防止をE2Eで確認する。

## Phase 2: CIとセキュリティ試験

### P2-1 CI必須checkの完成

lint修正とworkflow再有効化はPhase -1へ前倒し済み。本Phaseでは残りを完成させる。

- UI、build、DB、RLS、E2E、audit、secret scan、SBOMを必須checkに追加する。

### P2-2 認可テストマトリクス

決定（2026-07-16）: 全リソースの完全直積はやめる。記録・利用者・監査ログ・権限管理の4リソースは完全マトリクス、その他のリソースは代表ケース（別組織拒否・未ログイン拒否・権限なし拒否）に絞る。

- 未ログイン、一般、管理、オーナー、super admin、無効化ユーザーを用意する。
- 自組織/別組織、担当/未担当、削除済み、存在しないIDを上記4リソースの全CRUD・承認・出力・Storageで試す。
- UI非表示だけでなくServer Action/API/REST/RPC/署名URLを直接試す。
- 拒否・失敗監査も検証する。

## Phase 3: GCSファイル基盤（初期提供の対象外に変更）

決定（2026-07-16）: Phase 3は初期提供の必須要件から外し、提供後に実施する。初期提供はSupabase Storage＋WebP再エンコード・5分署名URLとし、JPEG/PNG/WebPだけを受け付ける。MIME・シグネチャ・実デコード照合、10MB・最大画素数、metadata除去、元ファイル非保存を提供条件にする。マルウェア検査未導入はaccepted-riskとする。

現状:

- 記録画像はSupabase Storageへ保存し、5分の署名URLを発行している。
- GCSは主にバックアップCSV/HTML用途であり、記録ファイルの正本ではない。
- 画像は10MB制限とWebP再エンコードがあるが、記録添付のPDF/HEIC保存仕様は未実装。

対応:

- 非公開GCSを記録ファイルの正本にするファイルメタデータschemaと認可APIを作る。
- JPEG/PNG/WebP/HEIC変換、PDF解析・安全化、20ファイル/50ページ上限を実装する。
- マルウェア検査をfail-closedにする。
- 東京本体、大阪複製、世代管理を構成する。
- Supabase StorageからGCSへの移行・照合・rollback手順を作る。

完了条件:

- 別組織が署名URLを得られず、GCSを直接公開できず、移行前後の件数・ハッシュが一致する。

## Phase 4: バックアップと監査

### P4-1 RPO 14時間対応の完全バックアップ

現状:

- Cronは日次・月次で、主に業務用CSV/HTMLエクスポートを生成する。
- Auth、全DB schema/data、設定、GCSファイルをまとめた完全復旧バックアップではない。

対応:

- 12時間ごとの完全論理DBバックアップをGitHub Actionsのcron workflowで実行し、gzip圧縮してGCSへ保存する。失敗時は30分後・2時間後に再試行し、手動実行も可能にする。最新成功世代または対象データ最大更新時刻が14時間を超えたらCritical通知する（限定提供中のRPOは14時間。接続情報はGitHub Secretsで管理し、Supavisorセッションプーラー経由で実行する）。
- roles、schema・RLS・関数・trigger、業務data、Auth schema、Storage metadata、画像inventory、migration一覧、秘密値を除く設定version、暗号鍵ID・所在情報、件数・サイズ・ハッシュmanifestを同一世代に含める。
- Supabase Storage画像を保存後にGCSへ非同期複製し、失敗をキューで再試行する。日次で件数・サイズ・ハッシュ・`storage_path`・関連ID・削除/hold状態を照合し、不足を補完する。最新の完全同期が26時間を超えたらCritical通知する。
- 直近24時間はStandard、日次35日はNearline、月次370日はArchiveとなるライフサイクルを設定する。object名は日時・ハッシュ付きとして上書きせず、同一内容を重複保存しない。
- 週次の自動復号・件数・ハッシュ検査と、提供前1回＋月次のDB・画像関連を含むStaging復元を実装する。
- 全損時のパスワード再設定フローを用意する。
- Stagingを緊急復旧先へ切り替え、環境変数・ドメイン切替後に新しいStagingを再構築する手順を実演する。
- RTO 4時間の適用範囲をProject単体障害等に限定し、リージョン・複数クラウド障害はbest-effortとして証跡に残す。

### P4-2 監査保全

現状:

- ハッシュチェーンはDBトリガーで実装済み（`supabase/migrations/20260630235959_init.sql`の`event_hash`算出トリガー）。
- 外部アーカイブは`/api/cron/archive-audit`で実装済み（GCSまたはHMAC署名付き外部送信、checkpoint管理あり）。
- 未実装なのはチェーンの毎日検証ジョブと、監査書込み障害時のfail-closed。

対応:

- 重要操作の成功・拒否・失敗を操作台帳と突合する。
- アプリ内1年、外部10年、週次チェーン検証を構成する（2026-07-16緩和。アーカイブ送信は毎日のまま）。
- 監査書込み障害時に重要操作をfail-closedにする。
- 出力・署名URL・緊急アクセス・バックアップ閲覧を記録する。

## Phase 5: PWA、競合、版管理

### P5-1 PWA再構築（初期提供の対象外に変更）

決定（2026-07-16）: 初期提供ではPWA・オフライン機能・暗号化下書きを提供せず、オンライン専用とする。現状の`ServiceWorkerCleanup`（既存SW登録解除＋キャッシュ削除）を維持する。認証後応答の`private, no-store`確認と、ログアウト後の戻る操作で認証後画面が再表示されない確認だけは初期提供でも行う。

### P5-2 楽観ロックと訂正版

現状:

- autosave revisionとrecord_versions、承認済みロックの基盤は存在する（競合検出は`reports.ts`のautosave経路のみ）。
- version番号による通常保存の競合検出は未実装（コード上に該当なし）。承認後訂正版作成UIも未実装として工数を見積もる。

対応:

- 更新対象versionを必須にし、競合専用エラーと差分確認UIを追加する。
- 承認済み記録の訂正版ワークフロー、理由、帳票表示をE2Eで確認する。

## Phase 6: 性能、監視、UX

2026-07-16縮小: レート制限はログイン試行・出力生成・ファイルアップロードに限定（汎用API制限は設けない）。100同時セッション試験は実施せず、初期設計規模の20同時セッションで成立を確認する。アクセシビリティはキーボード操作・コントラスト・入力エラー読み上げの3点を合格基準とする。

- DB容量300/400/450MBの監視と機能制限を実装する。
- ログイン試行、PDF/CSV/ZIP生成、ファイルアップロードのレート制限を実装する。
- p95、5xx、認証拒否、別組織ID試行、service role、CSP、バックアップ、監査、GCS容量を監視する。5分間隔の外形監視は個人情報を読まないDB health queryまで確認し、Supabase Free一時停止のリスクを下げるが防止は保証しない。
- スタッフ50人、利用者500人、記録10万件、シフト10万件相当と同時20セッションで一覧、検索、記録保存、シフト表示、PDF/CSV生成を計測する。容量安全弁を超える場合は実収容件数へ目標を修正する。
- 主要業務をキーボード操作、コントラスト、入力エラー読み上げで検証し、幅360px・200%拡大を確認する。
- CSV式、ZIP path、PDF metadataを安全化する。
- メール・push通知から個人情報を除外する。

## Phase 7: 段階提供

1. 空のStagingをmigrationから再構築する。
2. 全自動試験と、初期設計規模の20同時セッション性能試験を実行する。
3. GCSバックアップからStagingへ復元し、RPO/RTOを計測する。
4. [release-readiness-checklist.md](release-readiness-checklist.md)のCritical/Highを0件にする。
5. 少数事業所だけに機能フラグで提供する。
6. 日次でエラー、権限拒否、監査、容量、バックアップをレビューする。
7. Critical 0件、未解決かつ未受容のHigh 0件、RPO/RTO復元成功、最新バックアップ14時間以内、主要操作p95目標内、他組織漏えい・記録不整合・重大障害0件を確認してから拡大する。Free利用中は可用性99.5%を拡大条件にしない。

## 実装順序の原則

- 環境分離と削除ロックを最初に行う。
- RLS/service role移行をUI改善より先に行う。
- GCSファイル正本化の前にバックアップ・移行・rollbackを設計する。
- 破壊的migrationはexpand/contract方式にし、旧版と新版が共存できる期間を持つ。
- 各Phaseは実装だけでなく、対応する拒否テストと証跡まで完了してから次へ進む。
