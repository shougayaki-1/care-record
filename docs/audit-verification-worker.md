# 監査検証 worker の試作

Issue #152 / PR #245 の worker は未完成です。成功 receipt、週次 workflow、独立監視、snapshot の保持・回収は未実装です。起動すると監査データの snapshot が DB に複製されるため、保持・容量方針と切替基点を承認するまで実環境では起動しません。自動実行・IAM・secret の設定はこの変更に含みません。

worker は GitHub Actions の `google-github-actions/auth` による WIF 外部アカウント認証を前提とし、静的サービスアカウント鍵を拒否します。実際の IAM、bucket の保持設定、workflow と API の独立性は、この形式検証だけでは保証されません。環境ごとの権限と保持設定は別途確認が必要です。

将来の実行側は、`APP_ENV`、`AUDIT_ARCHIVE_MODE=v2`、監査 bucket・project と一致確認用 project、DB 外に固定した control の object 名・generation・SHA-256・サイズを既存アーカイブ設定と同じ変数で渡します。加えて固定 HTTPS origin (`AUDIT_VERIFIER_ORIGIN`)、`CRON_SECRET`、Discord webhook、WIF の `GOOGLE_APPLICATION_CREDENTIALS`、および実行ごとに安定した実開始時刻 `AUDIT_VERIFICATION_STARTED_AT` を渡します。v1 再計算設定がある場合は `AUDIT_RECOMPUTE_OBJECT`、`AUDIT_RECOMPUTE_GENERATION`、`AUDIT_RECOMPUTE_SHA256`、`AUDIT_RECOMPUTE_SIZE` をすべて固定します。

同じ GitHub Actions run・attempt の再送は同じ snapshot 要求 ID を使い、別 attempt は別 ID を使います。receipt の再送には同じ実開始時刻も必要です。`AUDIT_VERIFIER_ENABLED=true` がない場合、または認証・環境・固定参照が不正な場合は実行前に非成功で終了します。成功経路はまだなく、検証と通知を終えても現状は非成功です。通知不能や結果保存不能も非成功です。

入口は `npm run audit:verify` です。現時点では合成環境でのみ確認し、実環境への適用やスケジュール有効化には別途計画と承認が必要です。
