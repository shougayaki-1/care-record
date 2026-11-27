# 監査検証 worker の試作

Issue #152 / PR #245 の worker は未完成です。成功 receipt、週次 schedule、独立監視、snapshot の保持・回収は未実装です。起動すると監査データの snapshot が DB に複製されるため、保持・容量方針と切替基点を承認するまで実環境では起動しません。自動実行・IAM・secret の設定はこの変更に含みません。

worker は GitHub Actions の `google-github-actions/auth` による WIF 外部アカウント認証を前提とし、静的サービスアカウント鍵を拒否します。実際の IAM、bucket の保持設定、workflow と API の独立性は、この形式検証だけでは保証されません。環境ごとの権限と保持設定は別途確認が必要です。

将来の実行側は、`APP_ENV`、`AUDIT_ARCHIVE_MODE=v2`、監査 bucket・project と一致確認用 project、DB 外に固定した control の object 名・generation・SHA-256・サイズを既存アーカイブ設定と同じ変数で渡します。加えて固定 HTTPS origin (`AUDIT_VERIFIER_ORIGIN`)、`CRON_SECRET`、Discord webhook、WIF の `GOOGLE_APPLICATION_CREDENTIALS`、および実行ごとに安定した実開始時刻 `AUDIT_VERIFICATION_STARTED_AT` を渡します。v1 再計算設定がある場合は `AUDIT_RECOMPUTE_OBJECT`、`AUDIT_RECOMPUTE_GENERATION`、`AUDIT_RECOMPUTE_SHA256`、`AUDIT_RECOMPUTE_SIZE` をすべて固定します。

同じ GitHub Actions run・attempt の再送は同じ snapshot 要求 ID を使い、別 attempt は別 ID を使います。receipt の再送には同じ実開始時刻も必要です。`AUDIT_VERIFIER_ENABLED=true` がない場合、または認証・環境・固定参照が不正な場合は実行前に非成功で終了します。成功経路はまだなく、検証と通知を終えても現状は非成功です。通知不能や結果保存不能も非成功です。worker 起動前の依存取得・時刻取得・WIF 認証の失敗時は、ガード通過後に依存不要の固定分類通知を試みます。checkout が失敗して通知用スクリプトを取得できない場合や runner 自体の停止は通知を保証できず、独立監視が必要です。応答喪失時の再送では通知が重複する場合があります。

入口は `npm run audit:verify` です。手動 workflow は staging を既定とし、main 以外または `AUDIT_VERIFIER_MANUAL_ENABLED` 未設定では認証前に失敗します。production には別途 `AUDIT_VERIFIER_PRODUCTION_APPROVED` が必要です。これらの設定値は今回変更していません。実行 attempt の開始時刻は GitHub API の該当 attempt から読み、receipt の再送時に固定します。環境ごとの同時実行は直列化し、既存実行を中断しません。

現時点では合成環境でのみ確認し、実環境への適用や schedule 有効化には別途計画と承認が必要です。

## schedule の独立監視試作

`npm run audit:watch-schedule` は既定で無効です。将来、GitHub Actions と障害点を共有しない別の実行基盤から起動する想定で、control を固定 generation で読み、GitHub の scheduled run と環境名付き `Audit verification (<environment>)` ジョブ内の `Verify audit preservation` ステップ開始を確認します。手動実行や別環境、skip されたステップは数えません。再実行で対象ジョブが省かれる場合に備えて最大10 attempt を遡り、それより古い結果が必要なら未完了とします。8 日を超えて対象の開始がなければ固定分類で通知します。実際の schedule はまだ存在せず、監視先や定期起動も設定していません。

監視に対応する成功 receipt の契約はまだなく、対象ステップが開始されても検証成功とは扱いません。運用者が DB 外に固定した週次監視開始時刻から 8 日超は、検証成功を裏付ける対応済み証拠がない状態として通知し、プロセスは常に非ゼロで終了します。これは最後の成功 receipt からの経過時間を測定する完成済み監視ではありません。成功 receipt の形式・履歴の扱いを決めた後に更新する必要があります。

実行には環境別 control・bucket・project の固定値に加え、アーカイブ開始時刻とは別の `AUDIT_VERIFICATION_MONITORING_STARTED_AT`、読み取り専用の `AUDIT_WATCHDOG_GITHUB_TOKEN`、固定 Actions run link `AUDIT_WATCHDOG_EVIDENCE_URL`、Discord webhook と `AUDIT_SCHEDULE_WATCH_ENABLED=true` が必要です。静的 GCP 鍵や `GOOGLE_APPLICATION_CREDENTIALS` は受け付けず、実行基盤の ambient identity を使います。保存先の読み取り以外の GCS 操作は呼ばず、実 IAM の読み取り限定と通知配送は別途確認が必要です。schedule・IAM・secret を変更したり、有効化したりしていません。
