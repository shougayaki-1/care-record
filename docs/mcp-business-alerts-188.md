# 業務通知と定期確認（#188）

各利用者はプロフィール画面で、事業所ごとに「未承認の記録」「今後7日間の未割当シフト」のアプリ内通知を個別に選び、毎日または毎週に設定・停止できます。初期状態は停止中です。未承認には承認待ち・差戻しを含みます。週次は日本時間の月曜を週の始まりとし、その週に該当事項が初めて見つかった日に通知します。通知文は固定で、利用者名・記録本文・自由記入・対象IDを含みません。MCP は本人の設定状態とプロフィール画面へのリンクだけを参照し、設定・配信先・本文は変更できません。

毎回、現在の事業所所属とアカウント状態を確認します。記録は reports 管理と approve 権限を要し、assigned の場合は担当利用者の記録だけを判定します。未割当シフトは事業所全体の shift view 権限を要します。権限喪失や停止後は新しい通知を作りません。事業所・受信者・種別と日本時間の期間に基づく一意制約で再送を防ぎ、設定頻度を切り替えた同日にも重複しません。発生記録と既存 `notifications` 行の作成は一つの DB トランザクションです。

## 定期実行と停止

`.github/workflows/business-alerts.yml` は既存の GitHub Actions 定期実行と Supavisor 接続の方式を利用し、毎日 00:10 UTC（09:10 JST）に実行します。`BUSINESS_ALERTS_ENABLED` が `true` の環境だけ実行し、初期設定ではスキップします。通知そのものは各利用者もプロフィールで停止できます。全体停止は各 GitHub Environment の `BUSINESS_ALERTS_ENABLED` を外すか `false` にします。

配備前に staging と production の DB 接続先・環境を個別に確認し、それぞれ専用のログインロールを用意して `care_business_alert_worker` のみを付与します。この NOLOGIN グループは引数なしの `public.run_mcp_business_alerts()` だけに EXECUTE を持ち、業務テーブルの直接参照、汎用 service role、設定変更はできません。ログインは superuser、CREATEROLE、CREATEDB、他の業務権限を持たせないでください。パスワードや接続文字列を migration、ログ、PR に入れず、各 GitHub Environment の secret `BUSINESS_ALERT_DATABASE_URL` に設定します。`BUSINESS_ALERT_EXPECTED_HOST` と `BUSINESS_ALERT_EXPECTED_USER` は各環境の独立した固定値にし、接続文字列は `sslmode=verify-full` とします。ホスト・利用者・TLS の不一致は接続前に失敗します。staging で合成データと権限・停止・重複を検証してから production を有効化します。

スケジュール変更、ロールのログイン作成・付与、secret 設定と有効化は実環境に影響します。この PR はログイン資格情報を作成せず、有効化もしません。GitHub Actions の遅延・停止は定刻配信を保証しないため、実行失敗と未実行は既存の運用監視で確認してください。1回は最大10万件の購読を処理し、それを超えるとエラーでトランザクション全体をロールバックします。

2026-11-15: Context7 で PostgreSQL 17 の `INSERT ... ON CONFLICT` の原子性を確認しました。ローカル DB のロールバック付き検証で、許可された受信者・担当外・権限喪失・停止・日次/週次の重複を確認しました。実環境の接続先、スケジュール、資格情報および実際の配信は未設定・未検証です。
