# アーキテクチャ概要

## 認証・セッション

Supabase Auth（パスワード + Google OAuth）。`src/proxy.ts`（Next.js 16 の proxy、
旧middleware相当）が全リクエストで CSP nonce 生成と Supabase セッション更新
（`src/utils/supabase/middleware.ts`）を行う。

- ログインは Server Action `loginWithPassword` 経由。IP単位で15分5回失敗すると429
  （`src/utils/supabase/loginAttempts.ts`）。
- 無操作タイムアウト24時間、絶対セッション期限30日。クライアント、middleware、
  Server Actionで同じ値を使用する。正式な決定は`docs/system-decisions.md`に従う。
- パスワードポリシーの確定要件は8文字以上。現行実装の文字種要件は撤廃対象
  （`src/utils/passwordPolicy.ts`、`docs/implementation-gap-plan.md`）。

## 権限モデル（フレキシブルロール）

- 型定義とプリセットは `src/utils/permissions.ts`。
  - `records` / `shifts` / `internalWork`: アクション別に scope（`all` / `assigned` / `none`）
  - `management`: エリア別（staffs, clients, accounts, organization, integrations,
    auditLogs, reports, roles, organizationDelete, ownerTransfer）の boolean
- DB側は RLS ポリシーで**同じ制御を再実装**している（アプリ層とDB層の二重管理）。
  どちらか一方だけを変更すると権限漏れ・過剰付与が起きる。
  直近の整合修正は `supabase/migrations/20260701000002_permission_alignment.sql` 以降。
- 変更手順の詳細は `.claude/rules/supabase.md` を参照。

## Google カレンダー同期（シフト）

チャンク方式のサーバーバッチに統一。

- 真実の源: `shifts.google_event_id IS NULL` = 未同期。専用ステータステーブルは持たない。
- コア: `src/app/actions/shift.ts` の `syncToGoogleCalendarDirect` はエラーを握りつぶさず
  `SyncError`（kind: auth / rate_limit / transient / permanent / skipped）を投げる。
  `withRetry` が rate_limit / transient のみ指数バックオフで再試行。
- 対話的な作成/更新/削除は `trySyncSilently` 経由。同期失敗でもDB操作自体は成功させ、
  「未同期」として残し後から再同期可能にする。
- 一括同期はクライアントが `remaining=0` になるまでループする設計
  （`getSyncStatus` / `syncUnsyncedBatch(limit)` / `forceSyncBatch(cursor, limit)`）。
  Vercelの実行時間制限を避けるため1呼び出し上限は約20件。force は id 昇順の cursor ページング。
- 削除は Google 側の削除に成功した分だけ DB 側も削除する（孤児イベントを残さない）。

## AI 記録インポート

- `src/app/api/ai/extract/`: Vertex AI Gemini を使い SSE でストリーミング応答。
  `validation.ts` で入力検証。
- `src/lib/ai/`: プロンプト（`extractPrompt.ts`）、抽出結果スキーマ（`extractSchema.ts`、zod）、
  モデル選択（`model.ts`）、SSEクライアント（`sseClient.ts`）。
- 抽出結果は必ず zod スキーマで検証してから記録に反映する。

## バックアップ・データ保持

- Vercel cron 4本（`vercel.json`）: `purge`（日次）、`archive-audit`（日次）、
  `backup-daily`、`backup-monthly`。すべて `CRON_SECRET` で保護。
- GCS へのエクスポートは `src/utils/gcs/`（export / html / upload）。
- 保持期間ポリシーは `src/utils/supabase/retention.ts` / `retentionPolicy.ts`。
- 削除承認ワークフロー（申請→owner承認→論理削除）は `src/app/actions/deletionRequests.ts`。
  現状バックエンドのみで、UIはreport限定（要確認: 全面配線の要否）。

## 監査・コンプライアンス基盤

- `audit_events` は追記専用。認証イベント（`auth.login` / `auth.logout`）、
  監査ログのCSVエクスポート（`audit.export`）などを記録する。
- Googleトークンは AES-256-GCM で暗号化し、鍵ローテーション用 keyring を持つ
  （`src/utils/googleTokenCrypto.ts`、環境変数 `GOOGLE_TOKEN_ENCRYPTION_KEYS` /
  `GOOGLE_TOKEN_ACTIVE_KEY_ID`）。
- 詳細な準拠状況・責任分界は `docs/compliance/README.md` を正本とする。
