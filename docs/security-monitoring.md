# 不審アクセスの監視 (#159)

この実装はログイン異常の候補を集計し、個人情報を含まない Discord 通知と前日JSTの集計を送る。
攻撃確定という判定は行わない。Firewall の新たな Deny / Challengeや契約変更は行わない。
有効化・Discord実配送・ホスト済み環境の試験は、コードがあるだけでは確認済みにならない。

## 取得元と現状（2026-10-26）

| ソース | 取得・料金・保持 | 欠測・制約 |
| --- | --- | --- |
| Vercel Firewall | HobbyをCLIで確認。active config APIは404だが、CLI 65.2.0のTraffic/Alertsは取得可能。既存Webhook一覧は空 | opt-in後にaction別件数を取得。失敗した側はunavailableとして、欠測でアラートを解除しない。Account Webhookは現プランの対象外。詳細は[取得証跡](security-monitoring-sources.md) |
| `login_attempts` | 新規の集計専用SQL関数で5分・15分・前日JSTを読取。アプリ側のsalt付きハッシュをDB内で比較する。既存行は変更しない | データ保持は現状自動削除なし。急増による容量増は既存DB容量監視で確認。ハッシュ欠落はWarning。無活動と両方の書込み停止は区別できず `ingestion=unverified` |
| `audit_events` | `auth.login`件数と重要操作allowlistの前日件数のみ。本文・details・組織IDは出さない。既存の検索1年・外部10年の保持方針を変更しない | 15分のlogin_attemptsとの差が3件以上でWarning。OAuth、書込み順・境界等でも差が出るため「監査失敗確定」ではない。チェーン整合性・外部保存は #152 の領域 |
| Supabase Auth Audit Logs | [公式](https://supabase.com/docs/guides/auth/audit-logs)を確認。ホスト済みの保存設定・保持・プランは未確認 | Authへ直接アクセスした失敗、アプリのレート制限前の試行はこの集計では網羅しない。常に `Auth direct=unverified`。生ログの転送は追加していない |
| Actions / Discord | 5分監視、独立した毎時watchdog、前日集計は日付変更後の最初の成功時。Actions利用枠・Discord送信先は有効化前に確認 | GitHub遅延時は5分を保証しない。GitHub全体とDiscord同時停止は外部監視が必要。Actionsの失敗通知を別経路として有効にする |

Vercelは [Firewall Overview / Traffic](https://vercel.com/docs/vercel-firewall/firewall-observability) を
両プロジェクトのdashboardから確認する。#160でTraffic/AlertsのCLI取得を確認し、opt-inの集計連携を追加した。
[Vercel webhooks](https://vercel.com/docs/webhooks) はすべての遮断イベントを配信するものではない。
今回受信経路は作らないため、署名・リプレイ試験は対象外。有効化時にはraw bodyのHMAC-SHA1署名、
timing-safe比較、イベント重複排除、時刻・サイズ・schema・project検証を必須とする。

## DB権限と環境の分離

`20261026000001_security_monitor.sql` は追加のみ。`private.security_monitor_snapshot()` は時刻・件数・通知状態だけを返す。
`care_security_monitor` はNOLOGIN/NOBYPASSRLSで、テーブルSELECTやDMLは許可しない。
private schemaはPostgRESTへ公開しない。`security_monitor_save` のCASで状態だけを書き換える。
`anon` / `authenticated` / `service_role` に両関数の実行権はない。
組織横断の識別不能な基盤集計であり、業務権限 `permissions.ts` と既存RLSの変更はない。
新規state表はRLS有効・policyなし・全アプリロールをREVOKE。監査対象の業務操作ではなく派生状態のため監査イベントは追加しない。

Staging、Productionの順に通常のmigration手順で適用する。2026-10-27に両環境へ適用し、履歴を確認した。
DB管理者が環境ごとに `security_monitor_staging` / `security_monitor_production` の専用LOGINを作り、`care_security_monitor` のみを付与する。
LOGINを `postgres` / `authenticated` / `service_role` のmemberにしない。パスワードはsecret managerで生成する。
接続にはSupavisor session poolerを使い、project ref、LOGIN suffix、TLS CAを対応する環境で確認する。
`PGUSER` は `security_monitor_<環境>.<project ref>` のみ許可し、期待project refとの不一致を接続前に拒否する。
資格情報やCAをコマンド引数・ログへ出さない。SSLは `verify-full` 固定。

## 有効化

1. ホスト済みStagingでmigration適用・専用LOGINの直接テーブル読取拒否を確認する。
2. Discordで環境別のprivate channelとwebhookを作る。担当者だけに閲覧・管理権を与え、外部委託・保存条件を確認する。
3. 各GitHub Environmentに下記を設定する。Production/Stagingで資格情報・Webhook URLを共有しない。
4. `SECURITY_MONITOR_ENABLED=true` をStagingのみ設定し、手動 `Security monitoring` のprobeを実行する。
5. 合成試行の急増→一度だけ通知→継続時抑制→2回の低下で解消→再上昇で通知を確認する。Discord本文とActionsログに秘密情報がないことも確認する。
6. Discordを一時的に無効化した検証用webhookで失敗・復旧後のpending再送を確認する。Actions失敗通知の受信とwatchdogも確認する。
7. 証跡（commit、環境、日時、runリンク、件数、配送結果）をPRに記録し、Productionを同様に有効化する。
8. Repository Variable `SECURITY_MONITOR_SCHEDULE_ENABLED=true` を設定して、定期監視とwatchdogを有効化する。
   未設定時はscheduleのjobを起動せず、secret未投入のまま定期課金を始めない。main以外からの手動実行も拒否する。

| GitHub Environment 設定 | 種別 |
| --- | --- |
| `SECURITY_MONITOR_ENABLED` (`true` のみ起動) | Variable |
| `SECURITY_MONITOR_PGHOST`, `SECURITY_MONITOR_PGPORT`, `SECURITY_MONITOR_PGUSER` | Variable |
| `SECURITY_MONITOR_PROJECT_REF`（当該環境の20文字ref） | Variable |
| `SECURITY_MONITOR_PGPASSWORD`, `SECURITY_MONITOR_CA_CERT` | Secret |
| `DISCORD_SECURITY_WEBHOOK_URL` | Secret（既存backup用とは別） |
| `SECURITY_FIREWALL_ENABLED`（`true` のみCLI読取を起動） | Environment Variable |
| `VERCEL_SECURITY_READ_TOKEN` | Environment Secret（対象teamの読み取りに限定した資格情報） |

Stagingは利用者承認により、監視専用Webhook未設定時に同じEnvironmentの既存`DISCORD_ALERT_WEBHOOK_URL`を使える。
Productionも利用者の承認により、同じEnvironmentの既存バックアップ通知先を使用できる。
2026-10-27の利用者確認では閲覧者は本人のみ・保持期限なし。Discord側の設定を読み戻した証拠ではない。

### Stagingの合成通知検証

`verify_staging=true` の手動実行はStagingだけを対象にし、通常monitor job（Productionを含む）は実行しない。
許可済みbranch、専用LOGIN、検証用CA、Stagingの既存Supabase/Discord secretを必要とする。
このworkflowを含むPRのmerge後はmainから次のように実行できる。

```sh
gh workflow run security-monitor.yml --ref main -f verify_staging=true
```

`scripts/security/verify-staging.mjs` は開始時の試行件数・active/pending状態が空であることを確認する。
集計と通知ackは専用ロール・実PostgreSQL、合成行の挿入は固定Staging projectへのManagement APIを使用する。
すべての通知に`[SYNTHETIC TEST]`を付け、試行窓の外へ合成行を移した後もoutboxが再送できることを検証する。
配送障害はDiscordへ不正リクエストを送る代わりに、送信直前の例外として1回だけ模擬する。
合成行は自身のrun hashで限定して古い日時へ移す。DELETE、既存監査イベントの更新、実ユーザーのAuth操作は行わない。
最後に解消状態を確認する。異常終了時はpendingを消さず、復旧後の再送判断を運用者へ残す。

未設定時はinactiveを明記し、ゼロ件の成功レポートを出さない。workflowはmainからのみ運用する。
監視の定期実行を有効にするとActions使用量が増える。現在の契約枠・予算を確認してから有効化する。

## 通知の意味と対応

`scripts/security/monitor.mjs` の `rules` が初期閾値の正本。5分20失敗・15分50失敗、
単一IPから5アカウント以上／単一アカウントへ5IP以上、5失敗の後の成功をHigh候補とする。
共有ネットワークや利用者の操作でも起こるため、自動でアカウント停止・IP遮断しない。
ハッシュ欠落・件数不一致・20分以上の実行間隔はWarning、取得不能とwatchdog異常はCritical。
Highは速やかに認証・監査dashboardを確認し、Warningは当日中に確認する。
件数・時刻（JST/UTC）・時間窓・環境・Actions runを必ず付ける。

アラートは初回に送り、継続中は1時間ごとに再通知する。解除閾値（失敗5分<=5／15分<=10、他0）を
2回連続で満たすとInfoの解消通知を送り、次の上昇で再度通知する。欠測は解消観測に数えない。
短い急増はActionsの遅延で見逃す可能性がある。前日集計は完全な試行件数を再集計するが、
ユニークな攻撃件数や「終日異常なし」を意味しない。初回や長期停止後は直前の1日だけを集計し、
それ以前の欠落はActions履歴・DBから別途調査する。

Discord transportは[429 Retry-After](https://docs.discord.com/developers/topics/rate-limits)・5xx・通信エラーを
最大4回再試行する。30秒を超えるRetry-Afterは次回へ持ち越す。失敗したアラートはDB outboxに保持し、
観測窓が過ぎても再送する。永続的な配送失敗はrunを失敗にするが、残りの候補は処理する。
成功後にackを書き、途中失敗によって別アラートのackを消さない。送信直後のプロセス停止・応答消失では重複し得る
（Discordに冪等キーがないためat-least-once）。同環境の手動プロセスを並行起動しない。
取得不能時はDB状態で抑制できないためCriticalが各runで再通知され得る。

既存 `scripts/backup/notify-discord.sh` も同じNode transportへ接続し、従来の4引数・本文・終了コードを維持する。
URLをargvへ渡さず、redirectを禁止し、mentionsを抑止する。backupの通知には監視用outboxは適用せず、
配送失敗は従来通り呼出しworkflowの失敗となる。Ubuntu runnerのNode.jsが必要。

watchdogは別workflowで直近20分のmain上の環境別jobと収集stepの成功を調べる。
skip、失敗、未実行を正常と扱わず、毎時再通知する。watchdog自体の失敗はActions通知でも追う。
Discord自身が停止したときの確認先はActions失敗通知。これも同時に失われる環境では独立した外形監視を別途用意する。

## 秘密情報、保持、ローテーション

Discordに送るのはallowlist分類・数値・時刻・固定文言・queryのないこのリポジトリのActions run URLのみ。
email/IPハッシュも送らない。生IP、メール、氏名、記録、Cookie、JWT、audit details、URL query、DB例外は送信・ログ出力しない。
DB stateはsingleton・最大32KiBの派生情報で履歴を増やさない。Discordメッセージの保存期限・閲覧者は運営側で設定し、
未確認のまま準拠済みとしない。ActionsにDB snapshotや資格情報をartifact保存しない。

Firewallは`SECURITY_FIREWALL_ENABLED=true`で取得を有効にする。CLI 65.2.0をrunnerの一時ディレクトリに入れ、global版・アプリ依存は変更しない。
denyが20件以上の短期取得窓（要求15分、実窓を表示）、active alertが1件以上でHigh候補とする。
Vercel報告のalertと単なる遮断件数を区別し、アプリ侵害の確定とは表示しない。
前日JSTのアプリ集計に付けるFirewall件数は、保持制限に合わせた**直近24時間の取得窓**を明記する。
Firewallの日次取得失敗もWarningにし、前日全体の攻撃ゼロと扱わない。
CLIの取得失敗・新しい未知action・不正payloadは欠測。policyやWebhook作成は行わない。

Webhook交換は新しい環境別URLをsecretへ登録→probe→日次集計とwatchdog確認→旧webhookを失効の順。
失敗時は新secretを修正して再実行する。ロールパスワードも環境ごとに交換する。
実トラフィックで閾値を調整する場合は、個人情報のない件数と誤検知理由を記録し、ruleとテストをPRで更新する。

## 検証と残る外部確認

ローカルでは合成データ・fake Discordで検出→抑制→解消→再通知、再送、429/5xx、秘匿、watchdogを検証する。
DBは専用ローカルprojectで全migration適用、`security_monitor.test.sql`、既存security_hardeningを実行する。
E2E・実Discord送信・本番DB読取はこの検証に含まない。

Context7確認: 2026-10-26、Supabase PostgreSQL関数（SECURITY DEFINER、空search_path、PUBLIC EXECUTEのREVOKE）。
採用するCLIは既存の2.108.0。外部仕様を理由に依存バージョンを変更しない。
FirewallのCLI集計連携は追加済みだが、定期実行の設定、直接Authログ・ログ書込み失敗の独立検知、Supabaseの実プラン/保持・実配送の確認は未完であり、#159の受け入れ証跡を残す必要がある。
後続の契約・取得可否確認と環境検証は [#160 (Phase 2)](https://github.com/shougayaki-1/care-record/issues/160) で追跡する。

### 直接Auth失敗集計（未有効）

Staging・Productionそれぞれに対し、`SECURITY_AUTH_LOGS_ENABLED=true` の場合だけ、Management APIで
`invalid_credentials` の直近15分の件数を収集する。専用の `SUPABASE_SECURITY_LOGS_TOKEN` Environment secretが必要。
管理API tokenは集計stepだけに渡し、監視本体には件数だけを渡す。tokenの対象projectとログの読取権限を検証し、
広い権限を持つ既存tokenを流用しない。各環境の有効化と実配送は別途確認する。
50件以上でHigh、10件以下が2回連続で解消し、取得不能・不正・古いデータではWarningを出して解消しない。
失敗種別の一部に限定され、ログの遅延や欠落は区別できないため、0件を取込正常や安全と解釈しない。

### Discord通知の読み方

通知は本番かテスト環境か、確認の緊急度、何が起きたか、次に取る行動、対象期間を日本語で示す。
「解消」はその検出条件が解除されたことを表し、原因の調査が完了したことは意味しない。
「実行結果」はGitHub Actionsへのリンク。情報が取れなかったときはゼロ件・安全とは扱わない。
