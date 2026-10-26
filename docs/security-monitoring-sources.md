# 監視ソースの取得確認 (#160)

確認日: 2026-10-26 (JST)。読み取り操作のみで確認し、プラン、Firewallルール、secret、停止中projectは変更していない。

## Vercel

- Team: `shougayaki-1s-projects`、planはCLIのteam APIで **Hobby** と確認。
- Production: `care-record` (`prj_hM6VAEcC8T773hF48MSRHtkLKyl2`)
- Staging: `care-record-staging` (`prj_B1IUy7IKAuHXDWEelGooUkOR7Hgd`)
- active configの404はTraffic取得不可の証拠ではない。CLI **65.2.0** のTrafficは両方で取得できた。
  グローバルCLI **54.18.6** には `firewall traffic` がないため、グローバル版を変更せず固定版を一時実行した。
- 観測窓 `2026-10-25T14:00:00Z`〜`2026-10-26T15:00:00Z` でProductionはallow=367、deny=310、Stagingはallow=1。
  要求は24hでもbucket境界で取得窓が丸められるため、実際のperiodを通知に使う。
  Productionの同窓のactive/resolved alertsは0件。denyの310件から攻撃確定や侵害を断定しない。
- Webhook一覧は接続ツールでは403、同team/projectを指定したCLI APIでは取得成功・空だった。
  [Account Webhooks](https://vercel.com/docs/webhooks) はPro/Enterprise向けであり、Hobbyで受信経路を前提にしない。
  有料化・Webhook作成・Deny/Challengeの追加は行わない。
- [Traffic](https://vercel.com/docs/cli/firewall) は全プランで直近24時間を取得可能。
  [Observability Plus](https://vercel.com/docs/observability/observability-plus) の30日保持は追加しない。

```sh
npx --yes vercel@65.2.0 --scope team_ysW0wFQFYn4lGeDbqSnJtdDc \
  firewall traffic list --project prj_hM6VAEcC8T773hF48MSRHtkLKyl2 \
  --since 15m --dimension action --json
```

調査時もaction次元だけを要求した。IP、path、user-agent等のtop listは取得しない。
`scripts/security/firewall.mjs` は上流のstats・periodを検証し、allowlist actionの件数だけに再構成する。
将来CLIが余分なfieldを返しても生データは通知・状態へ保存しない。TrafficとAlertsは別々に取得し、
片方だけ失敗した場合は `incomplete` とnullを返し、ゼロへ置き換えない。

## Supabase

CLIで `care-record` (`ougdmklcwargnmaphkdn`) は `ACTIVE_HEALTHY`、
`care-record-staging` (`xhvvfovvlqzlkirpjocv`) は `INACTIVE` と確認。
ProductionはManagement APIを通じてREAD ONLYトランザクションで識別情報のない件数・migration番号だけを取得した。

- 確認時点の最新migrationは `20261007000003`。mainにあるaudit v2基盤・archiveと#159のmigrationは未適用。
  他Issueのmigrationも未適用なので、#159だけを先行適用してmigration履歴を飛ばさない。
- 直近24時間の件数は `audit_events` のauth.login=3、`auth.audit_log_entries`=0、`login_attempts`=0。
  login_attemptsはパスワード認証側の経路であり、OAuth等と単純に一致を要求しない。
  Auth Audit Logsの0件は、設定無効・直接Authの失敗なし・収集正常のいずれの証拠にもならない。
- [Auth Audit Logs](https://supabase.com/docs/guides/auth/audit-logs) はDBと外部ログの設定・保持が別である。
  今回はホスト済みAuthの保存設定・ログ取込の健全性を確認できていないため、`Auth direct` / `ingestion` はunverifiedのまま。
- [料金表](https://supabase.com/pricing) のFreeはAuth Audit Logsが1時間、API/Database logsが1日と区別されている。
  DB内監査表の保持と同一視しない。実organizationの契約・保存設定は未確認。
  Freeの低活動project停止・2 active project制限に注意し、有料Log DrainやProへの変更は行っていない。

## 有効化の前提

- Repositoryの `SECURITY_MONITOR_SCHEDULE_ENABLED` は未設定。新規監視の定期jobは無効。
- `staging` GitHub Environmentにはbranch policyがあるが、許可branch一覧が空。
  現状のままではホスト済みStagingのworkflowは実行できない。実行するbranchを明示して設定する必要がある。
- Stagingには既存 `DISCORD_ALERT_WEBHOOK_URL` / `VERCEL_TOKEN` 等のsecret名が存在するが、
  新しい最小権限LOGIN・監視専用Discord secretの投入と配送成功を確認したものではない。
- Production/Stagingのsecretを混用しない。通知先のprivate設定・閲覧者・保持期限は運営者の確認が必要。
- GitHub ActionsとDiscord双方が停止する場合の独立監視は未導入。Actions枠・外部監視サービスの契約も未確認。

次の有効化作業では、停止中Stagingの状態・再開方法と費用を確認し、既存migration一式のdry-runをレビューしてから適用する。
Stagingでの合成試行、専用ロールの権限拒否、実配送、障害時再送を記録した後にProductionを検討する。
監視の収集元を増やしても、未確認の経路をhealthyと表示しない。

Context7では2026-10-26にVercel Firewall Traffic/Alertsのプラン・窓、Supabaseの停止・Auth Audit Logsを確認した。

## 追加確認と実行予定（2026-10-27 JST）

利用者の回答を受け、通知方針は「既存Stagingバックアップ通知先、閲覧者は本人のみ、保持期限なし」として記録する。
これは利用者による方針確認であり、Discordの権限・保持設定をAPIで読み戻した証拠ではない。
Webhook URLやsecret値はチャット・証跡に記載しない。

読み取り専用で、両projectのAuth設定 `audit_log_disable_postgres=true` を確認した。
`auth.audit_log_entries` へ保存しない設定であり、同表の0件を直接Auth試行のゼロと解釈しない。
organization entitlementはログ保持1日、Log Drainとaudit Log Drainは利用不可だった。
統合ログAPIで `select count() as event_count from logs where source = 'auth_logs'` を直近15分に限定して実行し、
両環境とも取得成功・0件だった。生ログは取得していない。これはAPIの取得可否の確認であり、失敗イベントの網羅性や取込正常の証拠ではない。
Auth設定は変更していない。APIのClickHouse SQLと再開endpointを2026-10-27に一次資料・Context7で確認した。

以下の計画について利用者の明示承認を得て実行した。実施結果は後段を参照する。

承認済みの作業範囲は次の通りとする。

1. **既存Stagingだけを再開する。** 対象は `care-record-staging` / `xhvvfovvlqzlkirpjocv`。
   新規project作成、プラン変更、追加addon購入は行わない。追加費用が必要な条件なら実行せず確認する。
2. **Staging Environmentの許可branchを限定する。** `main` と `codex/issue-160-monitoring-sources` のみを許可し、
   検証branchの許可は試験終了後に削除する。Production Environmentや全branch許可には変更しない。
3. **Stagingのschema差分を再確認する。** 履歴とdry-runを読み、候補が下記の4本と一致する場合に限り順に適用する。
   異なる未適用migration、既存schemaとの不整合、予期しないデータ変更があれば中止する。
   既存migrationの編集・audit v2 triggerの有効化・履歴の修正は行わない。

   - `20261024000001_audit_v2_foundation.sql`
   - `20261024000002_audit_archive.sql`
   - `20261024000003_audit_archive_typed_initialization.sql`
   - `20261026000001_security_monitor.sql`

4. **Stagingの専用LOGINと検証設定を用意する。** `care_security_monitor` だけを継承し、
   生のlogin/audit行の取得拒否とTLS検証を確認する。資格情報はStagingのGitHub Environmentへだけ保存する。
   通知は承認済みの既存Staging通知先を使い、Productionの値をコピーしない。
5. **合成データで手動検証する。** 急増→初回通知→抑制→解消→再通知、配送失敗を模擬した後の再送を記録する。
   物理DELETE・業務記録や既存監査イベントの変更は行わない。定期実行は無効のままとし、E2Eを新たに実行しない。

Productionの再開・schema・secret・Firewallルール・通知先は、この検証変更の対象に含めない。

## 承認後の実施結果（2026-10-27 JST）

上記のStaging限定作業について利用者から「許可します」と明示承認を得て実行した。

| 項目 | 実施結果 |
| --- | --- |
| Staging再開 | 既存`xhvvfovvlqzlkirpjocv`を再開し、`ACTIVE_HEALTHY`を確認。プラン・addonの変更なし |
| migration | 履歴差分とCLI dry-runが予定4本だけと一致。順に適用し、DB履歴への4 version登録を別途確認 |
| 集計LOGIN | `security_monitor_staging`を作成し、`care_security_monitor`のみを継承。NOBYPASSRLS、NOSUPERUSER、NOCREATEDB、NOCREATEROLE |
| TLS | Supabase公式Studio参照の`prod-ca-2021.crt`を使い、session poolerで`verify-full`接続成功。CA検証を緩和していない |
| 権限拒否 | 同LOGINで`public.login_attempts` / `public.audit_events`の`SELECT ... LIMIT 0`がpermission denied。集計関数は実行可能 |
| Staging設定 | 専用password・CAをStaging Environment secretに登録。接続先・port・user・期待project refは同Environment variableに登録。秘密値はログに出していない |
| 合成DB/Discord検証 | [run 40408682272](https://github.com/shougayaki-1/care-record/actions/runs/40408682272)成功。通常monitor jobはskip、Staging検証jobだけ実行 |
| 一時branch許可の後処理 | 検証branchの許可を削除し、Staging Environmentはmainだけを許可する状態へ戻した |

検証runの結果JSONは`ok=true`、`storage=postgres`、`notification=discord`、
`duplicateSuppression=true`、`recovery=true`、`outboxRetry=true`。
`failures_5m`分類について初回・再開・模擬配送障害後の再送と各解消、計6件の送信成功を確認した。
他の合成分類・日次通知も発生し得るため、6件は通知総数を意味しない。
Discordがメッセージ作成を受理した証拠であり、利用者が既読にした証拠ではない。
試験後の集計は直近失敗0、該当alertはactive=false・pendingなし。合成行は物理削除せず試行窓外へ移した。

CLIはmigration適用後のpg-deltaカタログキャッシュにCAファイル参照の警告を出した。
終了コードだけで成功扱いにせず、4本の履歴・集計関数・専用LOGINでの接続を再確認して適用を確認した。

直接Authの別試験では、架空の`example.invalid`アカウントでStagingのpassword token endpointへ1回だけ失敗要求を送った。
アカウント作成・メール送信はしていない。Authログのstatusは文字列形式、pathは完全一致で扱えないため、
件数のみを返す集計へ修正して、HTTP失敗1件・`invalid_credentials`イベント1件を確認した。
アプリの試行表やDB内Auth監査表に依存せず観測できる経路の証跡である。
この確認は手動であり、直接Authとアプリ書込み失敗の継続監視を有効化したことを意味しない。

定期実行flagは無効のまま。Productionのschema・secret・Firewallルールには変更なし。
Production有効化、Auth/アプリ書込み失敗の継続検知、GitHub/Discord双方停止時の独立監視は残件として維持する。

## 直接Auth集計の追加（2026-10-27 JST）

Staging限定で `invalid_credentials` の15分間件数をSupabase Management APIから取得する実装を追加した。
ログ本文・アドレス・IP・識別子は取得せず、固定SQLで件数だけを返す。管理API tokenは監視本体と別stepに限定し、
監視本体へ渡す一時ファイルには件数と集計期間だけを保存する。専用DB LOGINに管理権限は付与しない。
`SECURITY_AUTH_LOGS_ENABLED=true` と監視本体の有効化が両方必要で、現在はいずれも有効化していない。
Stagingのread-only実接続で取得成功（15分間0件）を確認し、前段の合成認証失敗が同じ集計SQLで1件となった証跡と合わせて確認した。
50件以上でHigh、10件以下の2回連続で解消。取得不能・不正値・古い窓は0件とせずWarningとし、既存アラートを解消しない。

対象は `invalid_credentials` のみで、アプリ経由の失敗も含み得る。Supabaseのログ遅延、欠落、他の認証エラーの網羅性は保証できず、
ゼロ件は正常性の証拠ではない。通知の `Auth direct=unverified` は直接経路全体の網羅性・取込健全性が未検証であることを示す。
Productionへの接続は実装上拒否し、Production tokenは追加していない。Context7でSupabase Management APIのログSQL、
期間指定と権限を2026-10-27に確認した。アプリ両書込みの同時障害とActions/Discord双方停止時の独立検知は未解決。
