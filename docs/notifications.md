# 通知の共通契約

Issue #59 は通知基盤のみを扱い、業務イベントへの接続は後続 Issue で行う。
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
リンク先も固定のアプリ内一覧に限定し、未実装の詳細画面にはリンクを設けない。
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
