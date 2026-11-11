# MCPからの記録承認・差戻し（#183）

`prepare_record_transition` は対象事業所、記録ID、現在版、操作を指定して10分間有効な案を作ります。差戻しでは理由が必須です。案の作成は記録を変更しません。`get_record_transition_result` は案の状態を照会します。実際の承認・差戻しは、同じ本人が認証済みのCareRecord画面で対象、版、操作、理由を確認して実行します。

事業所ごとの設定は既定offで、記録参照も有効でなければ利用できません。停止・権限変更・接続解除・期限切れ、対象の版や内容の変更後は確定できません。確定時に既存の業務権限を再確認し、既存の状態遷移、通知、監査、案の消費を同一トランザクションで行います。再送は同じ結果を返します。差戻し理由は記録を閲覧できる利用者に画面で表示し、記録を編集しても同じ差戻し中は保持します。状態が変わった後の別の差戻しには以前の理由を表示しません。

既存の記録データを書き換えないDB migrationを先に適用し、次に確認・設定画面、最後にMCP関数を配備します。これにより旧アプリ稼働中は新ツールが公開されず、新画面から必要なRPCを利用できます。個別事業所の提供条件を管理者が確認するまで有効化せず、Staging/Productionへの適用と実OAuth接続の確認は別途実施します。

2026-11-11: Context7でSupabaseのDB関数の権限と、Next.js 16.4の動的ルートの `params` を確認。適用済みmigrationは変更しません。

ローカル並行試験: `scripts/db/test-mcp-report-transition-concurrency.mjs` は、migration適用済みの使い捨てDB `care_record_183_run` を `supabase_db_care-record-182-db` コンテナ内に用意した後に実行する。合成事業所を作成し、承認と停止が互いに待機する両順序で状態・監査を検査する。試験データは削除しない。スキーマだけを複製した試験DBではSupabase管理者専用の所有者・Realtime設定が再現されないため、この試験を空DBからの完全再構築の代替にはしない。

2026-11-11: 独立したローカルSupabase `care-record-183-fresh` で空DBからmigrationを適用し、`mcp_report_transition.test.sql` 33件、`mcp_report_transition_controls.test.sql` 13件、`mcp_role_security.sql` 1件、`security_hardening.test.sql` 56件を合成データで実行した。生成した `public` 型がコミット対象と一致することも確認した。ホスト済みOAuthの接続・実クライアントでの検証は実施していない。
