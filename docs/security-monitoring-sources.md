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
