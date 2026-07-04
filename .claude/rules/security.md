# セキュリティ・コンプライアンスルール

- 3省2ガイドライン準拠が前提。判定基準・責任分界は `docs/compliance/README.md`、
  実装箇所の索引は `docs/security-and-permissions.md`。
- `audit_events` は追記専用。既存イベントを更新・削除するコードを書かない。
  重要操作を追加する機能では監査イベント記録（`src/utils/supabase/audit.ts`）も追加する。
- Server Action / API Route で生の `error.message` を外部に throw しない。
  `src/utils/errors.ts` の `sanitizeDbError` / `withSafeError` を経由する。
- Googleトークン暗号化（`googleTokenCrypto.ts`）と鍵ローテーション keyring を変更する場合、
  既存トークンの復号互換を必ず検討し影響範囲を説明する。
- CSP（`src/proxy.ts`）とセキュリティヘッダ（`next.config.ts`）の緩和方向の変更は
  事前に理由と影響を提示し、承認を得てから行う。
- 意図的な未対応スコープ（MFA、記録本体のカラム暗号化、運用文書）を、指示なく
  「対応」として実装しない。対応する場合はユーザーに確認する。
