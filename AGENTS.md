# CareRecord リポジトリガイド

このファイルは Codex などの AI エージェント向けの入口です。詳細仕様はここへ複製せず、各正本を参照してください。CareRecord は要配慮個人情報を扱う訪問介護向け SaaS であり、**3省2ガイドライン準拠を最優先**します。

## 技術スタック

- Next.js 16（App Router、webpack、`src/proxy.ts`）、React 19 + React Compiler、TypeScript 5、zod 4
- MUI v7 + Emotion、Tailwind CSS 4
- Supabase（Auth / PostgreSQL / Storage、`@supabase/ssr`）。認可はアプリ層と RLS の二重管理
- Vertex AI Gemini、Google Calendar API、GCS
- Vitest（unit / Storybook browser tests）、Playwright（E2E）、Vercel

バージョン依存の外部 API を扱うときは、記憶に頼らず最新の一次ドキュメントを確認する。ただし、リポジトリ内の仕様・既存実装を優先し、差異があっても無断で移行しない。

## 最初に読む正本

- 全体ルールとコマンド: `CLAUDE.md`
- 承認済みの意思決定（他文書と矛盾する場合の優先文書）: `docs/system-decisions.md`
- 構成と実装状況: `docs/architecture.md`、`docs/feature-overview.md`、`docs/implementation-gap-plan.md`
- セキュリティと準拠: `docs/compliance/README.md`、`docs/security-and-permissions.md`
- UI: `docs/ui-system.md`、例外は `docs/ui-exceptions.md`
- 開発・リリース: `README.md`、`docs/development.md`
- 領域別の必須ルール: `.claude/rules/frontend.md`、`security.md`、`supabase.md`、`testing.md`

作業対象に固有の文書、テスト、近接する既存実装も、編集前に検索して読むこと。文書とコードに食い違いがあれば推測で解消せず、優先文書を確認して差異を報告する。

## ディレクトリ地図

- `src/app/app/`: 認証後の画面
- `src/app/actions/`: Server Actions と業務ロジックの中心
- `src/app/api/`: AI 抽出 SSE、cron、OAuth callback など
- `src/components/ui/`: 共通のセマンティック UI（新規 UI の第一選択）
- `src/utils/permissions.ts`: フレキシブルロールの定義
- `src/utils/supabase/`: 認証、監査、権限補助、保持期間
- `src/lib/ai/`: AI 抽出のプロンプト、schema、モデル、SSE client
- `supabase/migrations/`: 現行 migration（`old/` は適用対象外の歴史的アーカイブ）
- `supabase/tests/`: DB / セキュリティ検証
- `docs/`: 設計、準拠、運用の正本

## 作業原則

1. **実装前に調査する。** 同種の画面、Action、権限判定、監査イベント、テストを検索し、既存パターンを踏襲する。
2. **1 Issue = 1 責務を基本とする。** 依頼の達成に不要な cleanup、命名変更、整形、依存更新などの unrelated refactor を混ぜない。
3. 破壊的操作（migration 適用、データ削除、cron 変更）は実行前に計画と影響を提示する。
4. セキュリティ要件を緩和しない。CSP（`src/proxy.ts`）や security headers（`next.config.ts`）を緩める必要がある場合は、理由と影響を先に提示して承認を得る。
5. MFA など意図的な未対応範囲を、明示指示なしに実装しない。

## Branch / worktree rules

- `main` は常に統合済みの正本として扱う。新しい Issue の実装は、作業開始時点の最新 `origin/main` を基点にする。
- 作業開始前に必ず `git fetch origin` を行い、最新 `origin/main` の SHA と Git の実状態を確認する。AI は作業 branch を会話履歴から推測せず、チャット履歴、過去の worktree、以前の branch を暗黙の基点として使わない。
- 原則 **1 Issue = 1 branch = 1 PR** とし、複数 Issue を1つの branch に混在させない。
- branch 名は原則 `codex/issue-<issue番号>-<短い説明>` を使う（例: `codex/issue-34-record-feed`）。`ClaudeCode`、`AI-refactoring`、`worktree-agent3` のように Issue や目的を特定できない恒久的な branch 名を新規作成しない。
- PR が merge 済みの branch を新しい Issue に再利用しない。closed / merged 済みの古い branch 上で追加実装を始めない。
- branch が既に存在する場合も、現在の Issue に対応することを PR / commit history から確認してから利用する。
- 並行作業が必要なら、Issue ごとに専用 worktree + 専用 branch を作成する。
- 作業開始時に必ず以下を明示・確認する。Issue を伴わない repository maintenance は、その目的と Issue がないことを明記する。

  ```text
  issue: #XX
  branch: codex/issue-XX-...
  base: origin/main @ <SHA>
  pr: #XX または not created
  ```

- PR merge 後の branch は、特別な理由がない限り削除する。
- staging / release / deployment 用 branch を設ける場合は、用途を `AGENTS.md` または deployment documentation に明示し、通常の feature branch と区別する。既存 `staging` は現役の配備参照がないと確認できるまで削除しない。

### Before finishing work

作業終了時に `git status`、現在 branch 名、base に使った `origin/main` SHA、PR 番号、main へ merge 済みか、branch 削除可能かを確認し、最終報告に含める。

## DB、権限、データ保全

- **RLS と permissions は同時管理する。** RLS policy を変えたら `src/utils/permissions.ts` の対応定義を、`permissions.ts` を変えたら RLS を必ず照合し、整合確認を変更報告へ記載する。UI の非表示だけを認可にしない。
- 新規 table では RLS、有効な組織 scope、監査対象かを判断し、`anon` / `authenticated` / `service_role` の `GRANT` / `REVOKE` を同じ migration に明記する。関数では `GRANT EXECUTE` の要否も確認する。
- **既存 migration は変更禁止。** 適用済みファイルと `supabase/migrations/old/` は編集せず、変更は新しい migration ファイルとして追加する。
- `audit_events` は追記専用。既存イベントを update / delete しない。重要操作には `src/utils/supabase/audit.ts` を用いた監査記録を追加する。
- `record_versions` や承認済み記録の履歴・訂正の仕組みを迂回または弱体化しない。
- 物理 `DELETE` を追加しない。既存の論理削除、削除承認、保持期間（`src/utils/supabase/retention.ts` / `retentionPolicy.ts`）に従う。
- service role は通常業務で使わず、既存の限定用途 wrapper と allowlist に従う。テナント境界は session client + RLS または認可を内包する原子的 RPC で守る。

## secrets、環境変数、エラー

- secret をコード、fixture、ログ、commit に含めない。ローカル secret は commit 対象外の `.env.local` に置き、`.env.example` の公開・非公開区分に従う。
- service-role key、暗号鍵、GAS / cron / audit secret などサーバー専用変数に `NEXT_PUBLIC_` を付けない。環境間で資格情報を共有せず、本番値の欠落・不正・交差接続をダミー値で継続させない。
- Server Action / API から生の DB error や `error.message`、機密情報を返さない。`src/utils/errors.ts` の `withSafeError`、`sanitizeDbError`、`UserFacingError` を使う。
- Google token の暗号化や keyring を変える場合は、既存 token の復号互換性と rotation への影響を先に検討する。

## UI

- 対応するものがあれば、直接 MUI を組み立てず `src/components/ui` の export を最優先する。直接利用できる例外は `docs/ui-exceptions.md` に限る。
- 色は theme token を使い、product color の literal を追加しない。MUI v7 では `slotProps` を使い、deprecated な `InputProps` 系 API を新規利用しない。
- 共通 UI を追加・変更したら Storybook story も更新し、`npm run test:ui` を実行する。
- React Compiler が有効なため、`useMemo` / `useCallback` を習慣的に追加しない。

## Server Action の標準パターン

公開 Action 全体を `withSafeError('アクション名', async () => { ... })` で包み、原則として次の順序にする。

1. `assert*` による認証・認可
2. zod などによる入力検証
3. DB / 外部 API 呼び出し（DB error は `sanitizeDbError`）
4. `recordAuditEvent` による必要な監査記録

利用者に見せる検証・業務エラーは `UserFacingError` とする。安全化だけを目的とする変更で、既存の検証文言、権限判定、監査イベントを変更しない。

## テストと完了条件

- 変更後の最低限: `npm run typecheck` と `npm run lint -- --max-warnings=0`。
- `src/app/actions/*` / `src/utils/*` のロジック変更: `npm run test:unit`。
- `src/components/ui/*` の変更: story 更新 + `npm run test:ui`。
- `permissions.ts` / `supabase/migrations/*` の変更: local Supabase で migration を適用し、`supabase/tests/security_hardening.test.sql` と関連 unit tests を実行する。既存 migration の改変ではなく、空 DB からの再構築も考慮する。
- リリース相当の変更では `npm run build` も実行する。変更箇所に既存の追加検証があればそれも実施する。
- **E2E (`npm run test:e2e`) は勝手に実行しない。** `E2E_TEST_ENV=true` と専用 Supabase 環境が必要なため、ユーザーの確認を得る。
- 完了を宣言する前に、該当する検証コマンドを実際に実行する。未実行を「確認済み」とせず、失敗や環境制約をそのまま報告する。
