# アーキテクチャ概要

現行実装の参照先を2026-10-22に照合。承認済み方針は [system-decisions.md](system-decisions.md)、
配備・運用の確認状態は [deployment-runbook.md](deployment-runbook.md) を正本とする。

## 認証・セッション

Supabase Auth（パスワード + Google OAuth）。`src/proxy.ts`（Next.js 16 の proxy、
旧middleware相当）が全リクエストで CSP nonce 生成と Supabase セッション更新
（`src/utils/supabase/middleware.ts`）を行う。

- ログインは Server Action `loginWithPassword` 経由。IP・メールのハッシュで失敗を集計し、
  15分5回で試行を制限する。失敗回数に応じた遅延も適用する
  （`src/utils/supabase/loginAttempts.ts`）。
- 無操作タイムアウト24時間、絶対セッション期限30日。クライアント、middleware、
  Server Actionで同じ値を使用する。正式な決定は`docs/system-decisions.md`に従う。
- パスワードは8文字以上で、文字種要件は強制しない（`src/utils/passwordPolicy.ts`）。
  `docs/implementation-gap-plan.md` は2026-07-16時点の差分計画として残す。

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

- 同期状態は `shifts.google_event_id` と `google_sync_status` で管理する。未同期件数は
  未削除シフトの event ID欠落、`pending_upsert`、`failed` を対象にする。
  論理削除後の `pending_delete` は修復経路で再同期する。
- コア: `src/app/actions/shifts/googleSyncInternal.ts` の `syncToGoogleCalendarDirect` はエラーを握りつぶさず
  `SyncError`（kind: auth / rate_limit / transient / permanent / skipped）を投げる。
  `withRetry` が rate_limit / transient のみ指数バックオフで再試行。
- 公開同期Actionは `src/app/actions/shifts/googleSync.ts`、`src/app/actions/shift.ts` は公開入口の再export。
- 対話的な作成/更新/削除は `trySyncSilently` 経由。同期失敗でもDB操作自体は成功させ、
  「未同期」として残し後から再同期可能にする。
- 一括同期はクライアントが `remaining=0` になるまでループする設計
  （`getSyncStatus` / `syncUnsyncedBatch(limit)` / `forceSyncBatch(cursor, limit)`）。
  Vercelの実行時間制限を避けるため1呼び出し上限は約20件。force は id 昇順の cursor ページング。
- 削除は `src/app/actions/shifts/crud.ts` で保持方針・権限を検証し、DBの論理削除を確定してから
  Google側の削除を試みる。失敗時も論理削除を戻さず、修復経路でGoogle側を再同期する。

## AI 記録インポート

- `src/app/api/ai/extract/`: Vertex AI Gemini を使い SSE でストリーミング応答。
  `validation.ts` で入力検証。
- `src/lib/ai/`: プロンプト（`extractPrompt.ts`）、抽出結果スキーマ（`extractSchema.ts`、zod）、
  モデル選択（`model.ts`）、SSEクライアント（`sseClient.ts`）。
- 抽出結果は必ず zod スキーマで検証してから記録に反映する。

## バックアップ・データ保持

- Vercel cron 4本（`vercel.json`）: `purge`（日次）、`archive-audit`（日次）、
  `backup-daily`、`backup-monthly`。すべて `CRON_SECRET` で保護。
- 完全論理DBバックアップは `.github/workflows/full-backup.yml` で12時間ごとに実行する設計。
  Vercelの業務エクスポートとは別で、環境設定・取得結果・復元試験の確認は
  [backup-restore-bcp.md](compliance/backup-restore-bcp.md) と配備手順に従う。
- GCS へのエクスポートは `src/utils/gcs/`（export / html / upload）。
- 保持期間ポリシーは `src/utils/supabase/retention.ts` / `retentionPolicy.ts`。
- 削除承認ワークフロー（申請→owner承認→論理削除）は `src/app/actions/deletionRequests.ts`。
  対象はreportで、申請の一覧・承認・却下画面は `src/app/app/reports/deletion-requests/`。

## 通知基盤

- イベント・固定本文・3分類は `src/lib/notifications/`、backend helper は `src/utils/supabase/notifications.ts`。
- 通常業務は認可済みの原子的 RPC から private helper を呼び、受信者限定 RLS で閲覧・既読化する。
- 記録・削除申請、シフト本人影響変更、アカウント変更の通知は業務RPCへ接続済み。
  実装範囲と基盤バックアップ等の契約・PHI制限・重複防止・互換性は [notifications.md](notifications.md) を参照。

## 監査・コンプライアンス基盤

- `audit_events` は追記専用。認証イベント（`auth.login` / `auth.logout`）、
  監査ログのCSVエクスポート（`audit.export`）などを記録する。
- Googleトークンは AES-256-GCM で暗号化し、鍵ローテーション用 keyring を持つ
  （`src/utils/googleTokenCrypto.ts`、環境変数 `GOOGLE_TOKEN_ENCRYPTION_KEYS` /
  `GOOGLE_TOKEN_ACTIVE_KEY_ID`）。
- 詳細な準拠状況・責任分界は `docs/compliance/README.md` を正本とする。
