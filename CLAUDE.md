# CareRecord — 介護記録SaaS

訪問介護向けの記録・シフト・帳票管理。医療情報を扱うため
**3省2ガイドライン準拠が最優先制約**（詳細: docs/compliance/README.md）。

## 技術スタック（バージョン差分に注意）

- Next.js 16 (App Router, `--webpack`, middleware ではなく `src/proxy.ts`)
- React 19 (React Compiler 有効) / TypeScript 5 / zod 4
- MUI v7 + Emotion（UIルール: docs/ui-system.md を厳守）/ Tailwind 4
- Supabase (@supabase/ssr)。権限は RLS + `src/utils/permissions.ts` の二重管理
- Vertex AI Gemini (AI取込) / Google Calendar API (シフト同期) / GCS (バックアップ)
- デプロイ: Vercel（vercel.json に cron 4本）

## コマンド

- `npm run dev` / `npm run build`
- `npm run lint` / `npm run typecheck`
- `npm run test:unit`（Vitest, src/**/*.test.ts）
- `npm run test:ui`（Storybook ブラウザテスト）
- `npm run test:e2e`（Playwright。E2E_TEST_ENV=true と専用Supabase環境が必須。無断実行しない）
- Supabase ローカル: `supabase start` / `supabase migration new <name>`

## ディレクトリ地図

- `src/app/app/` 認証後アプリ本体 / `src/app/actions/` Server Actions（ロジックの中心）
- `src/app/api/` AI抽出SSE・cron・OAuth callback
- `src/utils/permissions.ts` フレキシブルロール定義 / `src/utils/supabase/` 監査・認証・保持期間
- `src/components/ui/` 共通UI（新規UIはここを最優先で使う）
- `supabase/migrations/` 現行マイグレーション（`old/` はアーカイブ、編集禁止）
- `docs/` 設計・運用文書 / `.claude/rules/` 領域別ルール

## 絶対ルール（高リスク領域）

1. **RLS/権限**: `permissions.ts` と RLS ポリシーは必ずセットで変更し、両者の整合を明示的に確認する。
   片方だけの変更は権限漏れを生む。→ .claude/rules/supabase.md
2. **監査・履歴**: `audit_events`（追記専用）、`record_versions`、論理削除の仕組みを
   弱める変更をしない。物理DELETEを追加しない。→ .claude/rules/security.md
3. **マイグレーション**: 既存ファイルの書き換え禁止。新規ファイルを追加する。
   `supabase/migrations/old/` は歴史的アーカイブで適用対象外。
4. **秘密情報**: サーバ専用の環境変数に `NEXT_PUBLIC_` を付けない。
   エラーメッセージは `src/utils/errors.ts` 経由で秘匿する。
5. **CSP/セキュリティヘッダ** (`src/proxy.ts`, `next.config.ts`): 緩和方向の変更は理由と影響を先に提示。
6. **UI**: 新規UIは `src/components/ui` のセマンティックコンポーネントを使う。
   直接MUIを使ってよい例外は docs/ui-exceptions.md のみ。

## context7 の使い方

- 外部ライブラリ・フレームワーク・SDK・API の使い方を確認するときは、学習データに
  頼らず context7 で最新ドキュメントを確認する。特に Next.js / React / MUI /
  Supabase / Google APIs / Vertex AI / Storybook / Vitest はメジャーバージョンが
  新しく、旧APIとの差分事故が起きやすい。
- context7 の内容と既存コードの実装が違っても、即座に書き換えない。
  差分・影響範囲・移行リスクを先に説明し、判断を仰ぐ。
- context7 を使ったら、確認したライブラリと機能を作業報告に含める
  （compliance 運用では確認日と対象バージョンの記録が求められる）。
- プロジェクト固有の仕様・設計は context7 ではなく、リポジトリ内のコード・
  docs/・.claude/rules/ を優先する。

## 作業の進め方

- 破壊的操作（マイグレーション適用、データ削除、cron変更）は実行前に計画を提示する。
- テスト・ビルドを実行していない場合、「確認済み」と報告しない。
- 詳細ルール: .claude/rules/（frontend / supabase / security / testing）
- 設計背景: docs/architecture.md、環境構築: docs/development.md、機能一覧: docs/feature-overview.md
