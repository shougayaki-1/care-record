# SDD Progress Ledger — Plan: AI記録取込機能

## Tasks
- [ ] Task 1: 依存パッケージ追加・環境変数定義
- [ ] Task 2: AIクライアント層の実装 (gemini.ts / extractSchema.ts / extractPrompt.ts)
- [ ] Task 3: Route Handler実装（SSE）
- [ ] Task 4: 単票モード UI（A/B） — AiImportButton + record/[clientId]統合
- [ ] Task 5: 一括取込ページ（C） — /ai-import + AiImportReviewTable
- [ ] Task 6: 監査ログ・セキュリティ

## Log
Task 1 (依存パッケージ追加): complete (commits 0f1c7f5..ef332b0, review clean)
Task 2 (AIクライアント層): complete (commits ef332b0..1f1e574, review clean — Important fix applied for GCP_PROJECT_ID guard)
Task 3 (Route Handler SSE): complete (commits 1f1e574..6afb28f, review clean — fixes applied: ReadableStream error guard + PII-safe logging)
Task 4 (単票モードUI): complete (commits 6afb28f..389f23f, review clean — fixes applied: SSE error flag + batch setAnswers)
Task 5 (一括取込ページ): complete (commits 389f23f..6a32d1a, review clean — fixes applied: confirmation dialog + useCallback stale closure)
Task 6 (監査ログ・セキュリティ): complete (commits 6a32d1a..1c0657c, review clean — Critical fix applied: organizationId moved to URL param before FormData parse)
Final whole-branch review: complete (commits 0f1c7f5..d77a994, Critical×3+Important×1 fixed: FormData key, grouping format, values shape, PHI leak)
