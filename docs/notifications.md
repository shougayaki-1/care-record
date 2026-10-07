# 通知の共通契約

Issue #59 の通知基盤に、Issue #60 の記録・記録削除申請、Issue #61 のシフト本人影響変更、Issue #62 のシステム障害、Issue #63 のアカウント変更イベントを接続する。
通知対象は本人の要対応、本人が行った提出・申請の結果、放置すると業務に支障がある異常に限る。
保存・通常 CRUD・同期の成功は Toast、操作証跡は audit log の責務とする。

## イベントと PHI

イベント名・分類・優先度・固定本文・遷移先は `src/lib/notifications/events.json` が共通定義。
`action_required` / `warning` / `info` は要対応 / 警告 / 情報として文字でも表示する。
`priority` は `normal` / `high` / `critical`。新しいイベントは契約と新規 migration で追加する。
DB helper は migration 内の固定テンプレートから生成し、unit test が両者の一致を検証する。

生成 API は任意の title/content/linkUrl を受け付けない。受信者・事業所・actor・resource は UUID のみ。
dedupeKey は業務イベント発生ごとに発行した UUID を再試行でも再利用する。
利用者氏名、支援内容、記録本文、差し戻し理由、医療・介護情報、ファイル名を本文・キーへ入れない。
リンク先は固定のアプリ内導線に限定する。記録・削除申請はDBで対象の事業所を検証したUUIDだけを
既存の記録詳細URLまたは削除申請一覧のqueryに追加し、任意URLは受け付けない。
詳細を表示する際は通常画面で再認可する。通知の受信・閲覧はリソースへの権限を付与しない。

## 生成と認可

- 通常業務: 認可済みの原子的 DB RPC 内から `private.create_notification` を呼ぶ。
  呼び出し元がセッション本人、操作権限、対象事業所、対象リソース、受信すべき本人を検証し、
  検証済みの値を渡す。private helper はブラウザから実行できない。
- 基盤バックアップ: `createNotification(client, input, failureMode)` に既存の用途別 wrapper で得た
  認可済み backend client を渡す。public RPC は service_role のみ実行可能で、`backup.failed` のみに限定する。
  新しい service role 用途や取得箇所は追加しない。その他のイベントを通常業務の service role 経由で作らない。
  既存の操作台帳に backup.failed の notifications 対象を明記する。接続する後続 Issue では
  受信者に該当事業所の backupStatus.view 権限があることを検証してから渡す。
- helper 自体は業務認可の代替ではない。受信者の所属、actor の所属、resource の事業所を DB で追加検証する。
  所属解除結果だけは受信者の現所属を要求しない。システムバックアップ異常は organization_id が null でも扱える。
  organization_id / actor_id は履歴の参照 ID として保持し、所属の寿命や削除と結合しない。

`dedupe_key` が指定されると `(user_id, organization_id, event_type, dedupe_key)` の unique index で
同時実行も重複を防ぐ。null organization も同じスコープとして扱う。
重複時は既存本文・既読状態を更新せず `duplicate` を返す。キーなしでは別通知になる。

失敗は既定の `required` で安全化した例外を返す。`best_effort` は `{ status: 'failed' }` と固定文言の
server log を残す。ログへ入力、DB エラー全文、外部応答を出さない。
後続の各イベントは通知が業務 mutation と同一トランザクションで必須か、失敗しても業務を継続するかを明示する。
通知必須なら atomic RPC 内で生成する。業務を保存してから通知失敗を投げても業務はロールバックされない。
通知は監査・版管理を置き換えず、基盤追加自体から業務の audit_events を生成しない。

## 閲覧・既読・互換性

既存の受信者限定 SELECT RLS と有効セッション要件を維持する。事業所所属を失っても本人の通知は閲覧できる。
UPDATE にも本人・有効セッションの restrictive policy を追加し、authenticated の更新列を is_read のみに絞る。
通知は management 権限ではなく本人のデータであり、`permissions.ts` の管理権限との対応を変更しない。
read_at は DB trigger が設定し、再度の既読更新では初回時刻を保持、未読化では null に戻す。
既存の既読通知は migration 実行時の観測時刻で埋める。過去の実際の既読時刻は不明。

既存 type/content/link_url を保存し、追加列が null の通知は approve を情報、それ以外を要対応として表示する。
従来の is_read 更新でも trigger が時刻を補完するため旧アプリと互換。
通知取得・既読の失敗はポップオーバー内で表示し、本文・リンク先の削除や権限喪失で一覧を破壊しない。
既読化後と Realtime INSERT/UPDATE 時に未読数・開いている一覧を再取得する。
既読更新が0件だった場合は成功を返さず、一覧の再取得が必要な状態として扱う。
対象が他ユーザーに属する場合や、表示後に削除された場合も同じ扱いとし、対象の詳細は返さない。
画面表示時刻は Asia/Tokyo とし、文字とアイコンで分類・未読状態を表示する。
パネルは Fade で表示し、一覧だけをスクロールさせる。ヘッダーの閉じる操作は
長い通知の末尾へスクロールしても表示範囲内に残す。

## 検証と適用

unit: 固定契約、PHI 入力拒否、helper の成功・重複・失敗、本人限定 Action、一覧の既読・エラー・再取得。
unit プロジェクトは jsdom の並列 CPU 競合による5秒タイムアウトを避けるため1ワーカーで実行する。
テストの制限時間・隔離・アサーションは変更しない。
Storybook: 分類・キーボード操作と 240 / 320 / 375 / 1280px の独立した iframe viewport で横幅・操作可能性。
各文書へ実コンポーネントと同じ theme/CssBaseline を描画し、Emotion の挿入先をその文書の head にする。
iframe の実 innerWidth を検証し、Vitest runner の viewport 変更や環境条件によるテスト省略を行わない。
表示完了後に寸法を測り、通知末尾の操作後にも閉じるボタンがパネル内に残ることを検証する。
DB: `supabase/tests/notifications.test.sql` と既存 `security_hardening.test.sql`。
新規 migration の空 DB 再構築・既存 DB 更新、型再生成との差分確認は専用ローカル環境で行う。
既存 migration は変更しない。適用禁止の worker では DB 検査を完了扱いしない。

Context7 確認: 2026-10-04、Supabase（導入 SDK 2.91 系）の RLS・RPC・GRANT、
Material UI v7.3.2 ドキュメント（導入 v7.3.7）の Popover slotProps と幅制御を確認。
2026-10-05、Vitest v4.1.6 ドキュメントでプロジェクトごとの maxWorkers を確認。
同日、Material UI v7.3.2 の transition slot と Modal のフォーカス復帰を確認し、
導入 v7.3.7 の Popover / Fade 実装と照合。
同日、Storybook v10.2.9 の play / document query / userEvent と、Emotion 11 の
createCache container / CacheProvider による iframe へのスタイル挿入を確認。

### 保存済み実装の独立検証（2026-10-05）

保存済み差分を最新 `origin/main` と一致する基点から専用チェックアウトへ移し、
ロックファイルの依存を独立にインストールして検証した。
通知の全Storybookテストは成功し、240 / 320 / 375 / 1280px の横幅、末尾の操作、
ヘッダーの閉じる操作、キーボード操作、フォーカス復帰を検証した。
全UIテストは23ファイル・68件成功。通知ベルのRealtime受信後の件数再取得と
購読解除もunitで検証し、INSERTによる増加と既読UPDATEによる減少を確認した。
全unitテストは79ファイル・470件成功。typecheck、lint（warning 0件）、
本番相当build、service-role台帳検査、CI分類17件、worker回帰96件、diff-checkも成功した。

DBテストで更新CTEを関数引数の内部に置いていた構文エラーを修正し、
receiver / organization / event のdedupe境界と再試行後の既読状態保持を追加検証した。
CLI 2.108.0の一時projectを使用し、旧migrationからの更新と空DBからの再構築の
両方で6ファイル・155件のpgTAP（既存security_hardeningを含む）が成功した。
旧通知の本文・リンク・既読/未読を保持し、既読時刻を補完することも検証した。
さらに別々の実トランザクションを競合させ、2件目が一意制約のロックを待ち、
両方のcommit後も通知が1件だけであることを確認した。
public schemaの再生成型はチェックイン対象と一致し、DB lintのwarningは0件。
使用した一時projectは検証後に停止・破棄した。

認可は本人限定RLSと有効セッションを維持する。通知は管理権限ではないため、
`permissions.ts` への新しい管理権限追加は不要であることを照合した。
PHIを含められる任意本文入力・ブラウザからの通知生成・他受信者の閲覧/既読更新は拒否する。
StorybookのinteractionとMUI Popoverのiframe/transitionの現行ドキュメント、
Supabase CLIのlocal migration/test/type generationの現行ドキュメントをContext7で確認した。

## システム障害通知（Issue #62）

Google 同期の受信者は、同じ事業所で `shifts.view = all` と `shifts.edit = all` の両方を持つ
ユーザー。`getSyncStatus` の操作認可と `/app/shifts/manage` の画面認可を照合した。
owner は既存の暗黙許可を使い、カスタムロールも同じ DB 権限 helper で選ぶ。
integrations のみ、delete のみ、assigned のみでは状態画面で同期に対応できないため通知しない。
バックアップは `management.backupStatus` を使用する。全イベントで退会・Auth 削除・ban・
super admin・削除済み事業所を除外し、受信者限定通知 RLS と `permissions.ts` は変更しない。

シフトの `google_sync_status = failed` 更新を trigger で検知し、private の事業所・シフト別
episode UUID を `private.create_notification` へ渡す。pending を挟む再試行でも UUID を維持し、
synced で閉じる。削除済みシフトの削除同期も対象。個別同期失敗も安全な failed status を保存する。
修復処理のカレンダー一覧取得に失敗した場合は、edit=all・有効所属・有効 session を検証する
`mark_google_calendar_sync_result` RPC が事業所単位の episode を管理する。一覧取得成功で閉じる。
任意本文・外部エラー・受信者・dedupe key はブラウザから渡せない。
状態行への同時更新と episode の一意制約、既存通知の一意制約で重複を防止する。

日次・月次 cron は既存の backup export client と #59 の `createNotification(..., 'best_effort')`
を使う。受信者を DB で選び、生成時にも現在の権限を再確認する。固定 job 名と対象日/月から
UUID を導出するため、同じ定期実行の再試行・二重実行は同一キー、翌日/月は別キーとなる。
組織の export/upload 失敗はその組織だけ、設定欠落・組織列挙失敗は影響する有効事業所へ通知する。
認証拒否は通知しない。手動バックアップ Action は通知に接続しない。

12時間ごとの完全バックアップは既存 `BACKUP_DATABASE_URL` の管理 DB 接続から
`private.notify_full_backup_failure` を呼ぶ。数値の `GITHUB_RUN_ID` を UUID に変換し、workflow
の再実行でも同一キー、次回 run は別キー。既存の30分後・2時間後の再試行、実行頻度を維持する。
全失敗またはバックアップ開始前の失敗時に呼び、backup 成功後の receipt/artifact だけの失敗では
ベル通知を作らない。追加の service role key、メール、外部通知 endpoint は不要。
この private 関数は migration 所有者（既存管理接続の postgres）専用で、API role へ grant しない。

通知生成はすべて best effort。通知 DB 障害でも元の同期状態・診断、cron response、workflow
の失敗を維持し、固定の server log を残す。成功・復旧の通知は作らない。
通知本文・リンク・category/priority は #59 の固定契約を維持する（warning は category）。
private episode table は RLS 有効、API role の DML grant なし。監査・状態の正本には使用しない。
新規 migration `20261006000004_failure_notifications.sql` は追加のみで旧アプリと互換。
Staging、Production の順にこの migration を適用してから main へ統合する。

Context7 確認: 2026-10-06、Supabase（導入 SDK 2.91 系）の SECURITY DEFINER・search_path・
RLS・EXECUTE grant と Supabase CLI（検証 2.108.0）の一時 workdir・local migration・
pgTAP・type generation を確認。Next.js 16.3.6 の同梱 route handler 文書とも照合した。

ローカル検証（2026-10-06）: 専用 worktree で typecheck、lint（warning 0）、unit 114ファイル/
774件、本番相当 build、service-role 台帳、CI分類17件、backup shell 2件が成功。
ユーザー承認済みの critical E2E は使い捨てローカル Supabase で5件成功。
CLI 2.108.0 の別 project ID/port を使い、旧schemaからの追加適用と空DBからの再構築の
両方で pgTAP 10ファイル/311件（security_hardening を含む）が成功。DB lint の警告なし、
public schema の再生成型はチェックイン型と一致した。
別々の実トランザクションによる同時更新でも、後続が行ロックを待ち、1 episode と
受信対象2人の通知だけが作られることを確認した。ホスト済み DB への適用は未実施。

### Hosted profiles の互換性（2026-10-06）

Production の `profiles` には初期 migration にある `role` 列が存在せず、既存 `is_super_admin()` も常に false を返す。追加 migration `20261006000005_failure_notification_profile_compat.sql` は `to_jsonb(profile)->>'role'` で任意の旧列を参照する。列が存在する環境では super_admin を除外し、存在しない環境では現行の組織権限と無効ユーザー除外をそのまま適用する。管理者列・権限の追加や既存 migration の書き換えは行わない。RLS と `permissions.ts` の定義は変更せず、既存の private 権限 helper を引き続き使用する。

Production で未適用の 000004 と 000005 は同一トランザクションで実行する。000004 の関数作成時だけ `SET LOCAL check_function_bodies=off` で前方参照の検証を遅延し、000005 の前に on に戻して互換関数を検証する。実行した SQL と migration history を同じトランザクションで記録し、不完全な関数を公開しない。Staging 適用済みの 000004 は維持して 000005 のみ通常適用する。PostgreSQL 17 の関数検証と JSON composite 変換を Context7 の公式文書で確認した。

## 記録・削除申請への接続（Issue #60）

記録の `pending / approved / remanded` への実際の状態変更と、記録削除申請の作成・承認・却下で、
既存の認可済みRPCによる変更のAFTER triggerから `private.create_notification` を呼ぶ。
通知は `required` とし、通知失敗時は固定文言をDB server logに残してRPC全体をロールバックする。
保存・監査・版管理のRPCを分割せず、既存audit eventを維持する。過去の状態は遡及通知しない。
同じstatusの保存、自動保存、draft保存は通知しない。

| イベント | 受信者 | 分類 |
| --- | --- | --- |
| report.submitted | 当該組織のreports管理権限と、対象clientのrecords.approve（allまたは担当済みassigned）を持つメンバー | action_required |
| report.approved | 記録の提出者（helper_id、現所属がある場合） | info |
| report.remanded | 記録の提出者（同上） | action_required |
| deletion_request.created | 当該組織のreports管理権限を持つメンバー | action_required |
| deletion_request.approved | 申請者（現所属がある場合） | info |
| deletion_request.rejected | 申請者（同上） | action_required |

退会・Auth削除・ban・super admin・削除済み事業所を受信対象から除外する。
Hosted profilesの任意の旧role列はJSONで参照し、本番の列なし構成と互換にする。
受信者判定は `transitionReports` / `transition_reports_authorized` と
`decide_report_deletion` の現行契約に合わせる。ownerという区分だけで列挙しない。
削除申請の却下はreports管理権限だけで可能なので、削除承認権限のない管理者も作成通知の対象になる。
承認は既存どおり追加のdelete権限を要求する。assignedの承認条件はActionがclient担当、DBが記録著者を要求する
既存の差異を維持し、通知のために権限を変更しない。`permissions.ts` のall/assigned/none・管理booleanと照合済み。

記録の発生UUIDは実際の状態変更ごとにDBで生成し、同一受信者へのRPC replay・同じstatusの二重更新では
新しい通知を作らない。承認→差し戻し→再提出は別UUIDになる。削除申請は申請UUIDをdedupeに使い、
同じ申請者・組織・記録の未処理申請をadvisory transaction lock下で再利用する。
二重送信や同時送信でも申請・通知を増やさず、処理後の新しい申請は別UUIDになる。

記録通知は `/app/record/[clientId]?reportId=...`、削除通知は
`/app/reports/deletion-requests?requestId=...` へ遷移する。
通知が現在の選択事業所と異なる場合は、`setLastOrganization` で所属を再認可し、workspaceを再取得してから遷移する。
所属喪失時は通知履歴だけを保持し、対象画面への遷移は拒否する。リソース権限の喪失は通常の画面・Action・RLSで拒否する。
申請者の結果確認には、所属と有効sessionを要求する本人のreport申請限定SELECT policyを追加した。
一覧Actionはsession client + RLSを使い、他人・他組織の申請を返さない。記録詳細リンクも通常のreport SELECT RLSで検証する。

Context7確認: 2026-10-06、Supabase（導入SDK 2.91系、DB PostgreSQL 17）の
trigger、SECURITY DEFINER / search_path、RLS・トランザクションを確認。
2026-10-07、Next.js 16.2.9のuseSearchParams / Suspenseを確認し、導入16.3.6の同梱ドキュメントと照合。

検証（2026-10-07）: 専用project ID・空きポートの使い捨てローカルSupabase（CLI 2.108.0）で、
既存migrationからの更新・空DB再構築の両方で全DBテスト11ファイル358件が成功。
DB lintにwarning/errorはなく、生成型は既存スクリプトと同じ末尾改行正規化後に一致した。
独立した2つの認証済みトランザクションによる削除申請の同時送信は同じ申請IDを返し、
申請1件・作成通知1件（単一処理者fixture）のままcommitされることを確認した。
unitは116ファイル789件、Storybookは29ファイル87件成功。typecheck、lint（warning 0）、
本番相当build、service-role台帳検査、CI分類17件、diff-checkも成功。
E2Eは実行していない。Staging / Productionへのmigration適用・配備は実施していない。
検証用DBは終了後に停止・破棄した。

## シフトの本人影響通知（Issue #61）

`shift.assigned` は情報（`info`）、`shift.unassigned` / `shift.time_changed` /
`shift.cancelled` / `shift.reopened` は要対応（`action_required`）。このIssueの
「priority」の情報・要対応は、共通契約では `category` に対応する。
本文・タイトルは共通定義の固定文言だけを使い、利用者名、支援内容、シフトタイトル、
備考、キャンセル理由を含めない。遷移先は既存の `/app/shifts/my`。

親シフトの `start_at` / `end_at`、`status` の cancelled 境界、
`shift_staffs` の staff ID 集合、および担当者別の区分 `start_at` / `end_at` を比較する。
区分のID・並び順・職種・サービス種別、備考、タイトル、内部属性、Google同期状態だけの
変更は通知しない。日時はepoch値で比較し、同じ時刻の別timezone表記も再通知しない。
新規作成・自動生成は追加担当者だけへ割当通知を送り、再生成・再送・同一内容の再保存はno-op。
親日時変更は更新後の担当者へ、区分日時変更はその区分で勤務時間が変わった継続担当者へ送る。
担当解除は更新前だけに存在するスタッフへ送り、取消・再開は更新後の担当者へ送る。

private の比較状態テーブルは1シフト1行で組織ID・スタッフID・日時・状態を保持する。
RLS有効・API全ロールへのアクセスREVOKEとし、通常の業務履歴や監査として使わない。
導入時は既存シフトの状態を初期化し、過去の割当を通知しない。
認可済みの既存RPC / RLS更新から比較をキューし、同一トランザクションの終了時に
最終状態を比較する。区分保存に伴うスタッフ一覧のdelete/reinsertから
一時的な解除・再割当を通知しない。同じスタッフが複数区分にいても通知は重複しない。
状態行ロックと発生ごとのUUID、共通unique indexで再送・同時更新の重複を防ぎ、
別の時刻への再変更・実際の再割当は新しい通知になる。

通常編集の区分保存と親シフト更新は `update_shift_with_segments_atomic` へまとめる。
セッション・edit all scope・同一事業所・対象アクセス・利用者アクセスをDBでも検証し、
区分保存は既存RPCの検証を使う。実更新行を返した後だけ、既存の監査・Google同期に進む。
区分付き記録の編集制限、同期キュー、タイトル再構築を維持する。
通知は `required` として業務更新と同じトランザクションに含め、生成失敗時は
親シフト・区分・担当・通知をすべてロールバックする。ログは固定文言だけを残す。

受信者は同じ事業所の有効なstaff→user紐付けを持つ所属ユーザーだけ。
共通の有効所属判定 `private.report_workflow_recipients` を利用し、退会・Auth削除・ban・
super admin・削除済み事業所・削除済みstaffを除外する。未紐付けや他組織ユーザーは
通知不能としてスキップし、シフト保存を失敗させない。
actorとreceiverが同一なら自己通知を抑制し、別スタッフへの変更は必ず対象者へ送る。
通知の本人限定RLS、シフトの既存認可、`permissions.ts` のscopeと整合を確認し、
既存の権限・RLS policyは変更しない。新しい管理権限やservice role用途は追加しない。

Context7確認: 2026-10-07、Supabase公式のPostgreSQL trigger、security definer、
固定search_pathと明示的EXECUTE権限。対象はSupabase JS 2.108.2、PostgreSQL 17、
Supabase CLI 2.108.0。Next.js 16.3.6同梱のuse-serverガイドも確認した。
依存バージョンを移行せず、新規migrationだけを追加する。

### Issue #61 の検証（2026-10-07）

`npm run typecheck`、`npm run lint -- --max-warnings=0`、`npm run test:unit`
（116ファイル・793件）、`npm run build`、`npm run security:service-role`、
`npm run test:ci-scope`（17件）、`git diff --check` が成功した。
専用の一時ローカルSupabaseで、既存migrationからの更新と空DBからの再構築を実施。
既存の合成シフトを含む更新確認4件、全pgTAP（12ファイル・401件、
うち本Issueの43件）、DB lint（warning 0件）が成功した。
public schemaの再生成型との差分は新規RPCの追加だけで、チェックイン型と一致する。
2つの実トランザクションで同じ日時変更を競合させ、両方のcommit後に通知が1件だけであることも確認した。
E2E・クラウドmigration・実Google連携は実行していない。

## アカウント変更通知（Issue #63）

`account.permissions_changed` と `account.removed_from_organization` は `action_required` に分類する。
通知は対象ユーザー本人だけへ送り、固定本文と参照 UUID を保存する。リンクは null とし、
除外済み事業所へ切り替えたり、内部ページへ遷移したりしない。本人限定・有効セッションの
既存通知 RLS は所属を要求しないため、所属解除後も本人は閲覧・既読化できる。
RLS と `permissions.ts` の権限定義は変更せず、DB の既存 scope / management helper と
アプリの権限キー（records、shifts、internalWork、management）を照合した。

新規 migration `20261007000003_account_notifications.sql` は membership、業務ロール割当、
ロール定義変更を trigger で検出する。private の比較状態に変更前の実効権限・owner 区分を保持し、
遅延 trigger で同一トランザクションの最終状態と比較する。割当 RPC の削除・再登録途中の
状態では通知しない。同一権限の再保存、同等・重複ロールの割当、ロール名・色の変更では通知しない。
共有ロールの権限変更・削除は実効権限が変わったメンバーへ通知する。owner の暗黙権限は既存 helper を使う。
オーナー追加・移管は他人の owner 区分変更を通知し、本人による明示的な自己変更・脱退は抑制する。
招待作成・編集・削除、初回所属・招待受諾、事業所削除、退会・無効アカウントは対象外。

通知生成は required とし、業務 mutation と同一トランザクションで commit / rollback する。
既存 RPC の認可、危険権限・最後の管理者・owner 保護、再認証、監査を維持する。
ロール割当・定義編集は既存の組織行ロックを共有し、owner 変更・除外と直列化する。
受信者ごとの状態行ロックと発生 UUID、既存通知 unique index で重複を防ぐ。
retry は最終状態が変わらないため通知せず、除外 retry の member_not_found も通知を追加しない。
private 比較状態は RLS 有効・API role の DML / helper EXECUTE grant なし。
比較用の権限 JSON は通知本文・キーへ転記しない。既存 migration は変更しない。

Context7 確認: 2026-10-07、Supabase（導入 SDK 2.91 系）の Postgres trigger、
SECURITY DEFINER の空 search_path と明示的な EXECUTE revoke を確認した。
DB 検証は Supabase CLI 2.108.0 の専用一時ローカル project を使用する。

ローカル検証（2026-10-07）: typecheck、lint（warning 0）、unit 116ファイル / 795件、
本番 build、service-role 台帳、diff-check が成功。CLI 2.108.0 の一時 project で
旧schemaからの追加適用と空DB再構築を確認し、最終の pgTAP 13ファイル / 435件
（security_hardening を含む）が成功。DB lint のエラー・警告なし、public schema の再生成型は変更なし。
既存所属の追加適用時に過去通知が生成されないことと、空DB再構築後・追加適用後の両方で
同時の2件の権限保存が commit し、通知が1件になることを実トランザクションで確認した。
E2E とホスト済み migration は実行していない。

検証時に既存の招待編集 RPC `account_update_role(..., 'invited', 'member')` が
`invitations_role_check` に拒否される不整合も確認した。#63 では修正せず、失敗時に通知が残らない
ことを回帰テストに記録した。招待の本文・配送・権限編集の修正は本Issueの対象外。
