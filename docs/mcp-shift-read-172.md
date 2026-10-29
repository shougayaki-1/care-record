# MCP シフト参照（Issue #172）

`list_shifts` と `get_shift` は読取専用。DB のシフトが正本で、Google 同期状態は補足情報。利用者・スタッフは名前検索せず、確認済み UUID のみを指定する。同名対象を推測しない。

一覧の入力は `organization_id`, `start_date`, `end_date`（JST の YYYY-MM-DD、両端を含む）、任意の `client_id`, `staff_id`, `unassigned`, `sync_status`, `limit`（1〜100、既定50）, `offset`（0〜10000）。期間に少しでも重なるシフトを返し、開始時刻・ID の昇順で並ぶ。指定期間は最大366日。詳細は `organization_id` と `shift_id`。応答の `start_at` / `end_at` はタイムゾーン付き時刻、`business_date` は開始時刻の JST 日付。取消は状態付きで返し、論理削除済みは返さない。結果にはセグメントと担当者、同期状態を含む。利用者名は既存の利用者参照権限がない場合 null。詳細が存在しない場合と閲覧できない場合はいずれも null。

例（識別子は合成値）:

```json
{"organization_id":"17200000-0000-0000-0000-000000000002","start_date":"2026-11-01","end_date":"2026-11-07","limit":50,"offset":0}
```

出力は `{ "shifts": [...], "has_more": false, "limit": 50, "offset": 0 }`。詳細は `{ "shift": {...} }`。シフトは ID、事業所・利用者 ID、閲覧可能な利用者名、タイトル、開始・終了、業務日、状態・取消理由、同期状態、閲覧可能な記録の状態、スタッフ、セグメントを含む。

事業所別の `mcp_shift_read_controls` は既定 off で、既存候補送信の設定とは独立。OAuth セッション、所属、`shifts.view` と既存 DB の担当範囲を一覧・詳細 RPC の呼出しごとに確認する。事業所管理の integrations 権限を持つブラウザ利用者が `enable_mcp_shift_read` で6項目の確認を記録して有効化し、`disable_mcp_shift_read` で停止する。設定と監査は同一トランザクション。MCP ロールにこれらの管理 RPC やテーブルへの権限はない。提供条件の確認が完了するまでは有効化しない。

実環境への migration・関数配備・事業所の有効化は別途実施する。ステージングの実認証・実 MCP クライアントの試験と外部サービスの取扱条件はこの文書だけでは確認済みとしない。
