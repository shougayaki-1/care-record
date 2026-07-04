# セキュリティ・権限の実装マップ

3省2ガイドライン準拠状況の正本は `docs/compliance/README.md` および
`docs/compliance/control-matrix.md`。本ファイルは「その実装がコード上どこにあるか」の
索引であり、準拠判定そのものはcompliance側に従う。

## 権限（フレキシブルロール）

- 定義: `src/utils/permissions.ts`（scope: all/assigned/none、managementはboolean）
- 割当・編集画面: `src/app/app/settings/roles/`, `src/app/app/accounts/`
- DB側の実体: RLSポリシー（`supabase/migrations/`）。アプリ側の定義とは**二重管理**なので、
  一方を変更したら他方の整合を確認する（`.claude/rules/supabase.md`）。
- 安全補助: `src/utils/supabase/roleSafety.ts`

## 認証・セッション

- Supabase Auth（パスワード + Google OAuth）、`src/utils/supabase/auth.ts`
- ログイン試行制限: `src/utils/supabase/loginAttempts.ts`
- アイドルタイムアウト: `src/components/auth/IdleTimeout.tsx`
- パスワードポリシー: `src/utils/passwordPolicy.ts`
- OAuth nonce検証: `src/utils/supabase/oauthNonce.ts`

## 監査ログ

- 追記専用テーブル `audit_events`、記録処理: `src/utils/supabase/audit.ts`
- 外部アーカイブ送信（別アカウント/WORM相当）: 環境変数 `AUDIT_ARCHIVE_URL` /
  `AUDIT_ARCHIVE_HMAC_SECRET`（署名検証・重複排除は受信側の実装に依存、要確認）
- 閲覧・CSVエクスポートUI: `src/app/app/logs/`

## 暗号化・秘密情報

- Googleトークン: AES-256-GCM、鍵ローテーション対応（`src/utils/googleTokenCrypto.ts`）
- エラー秘匿: `src/utils/errors.ts`（`sanitizeDbError` / `withSafeError`）
- 環境変数の公開/非公開区分: `.env.example` のコメントに従う。サーバ専用変数に
  `NEXT_PUBLIC_` を付けない。

## データ保持・削除

- 保持期間ポリシー: `src/utils/supabase/retention.ts` / `retentionPolicy.ts`
- 自動purge: `src/app/api/cron/purge/`（`CRON_SECRET`保護、dryRun対応）
- 削除承認ワークフロー: `src/app/actions/deletionRequests.ts`（申請→owner承認→論理削除。
  現状バックエンドのみでUI配線はreport限定 — 要確認）

## CSP・セキュリティヘッダ

- CSP nonce生成とセッション更新: `src/proxy.ts`
- 固定ヘッダ（X-Frame-Options, HSTS等）: `next.config.ts`

## 意図的な未対応スコープ

ユーザー確定事項として以下は対象外（詳細は auto-memory の
`3sho-2-guideline-compliance` を参照）:

- 二要素認証（MFA）
- 記録本体のカラム暗号化（Supabase標準の保存時暗号化に依拠）
- 組織的・運用的措置（運用規程・責任者任命・インシデント手順等の文書）
