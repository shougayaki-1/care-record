# ローカル未コミット作業の整理（2026-10-03）

最新main `345e851`（PR #46反映後）を基準に、古いHEAD `3cbae88` に残っていた169ファイルを確認した。
現在の作業ブランチは `codex/recover-unmerged-work-20261003`。

## 採用した変更

- Issue #39: 自分のシフト取得を型付きの結果にし、スタッフ未紐付け・内部障害・シフト0件を区別。再試行と独立ログアウト復旧を表示する。記録選択画面は最新mainのフィード更新・古いレスポンス排除を維持する。
- AI取込: Gemini/OpenAIの選択、OpenAI Responses API、厳密スキーマ、送信先の表示、Google Gen AI SDKへの移行。読めない値をnullで扱い、フォームに合う値だけを採用し、曖昧な氏名を自動照合しない。
- AIレビュー: 複数原本の表示、移動時間の反映、内容変更後の再確認。最新mainの保存再試行・冪等キー・記録フィード更新・共通フォームは維持する。
- 公開アセット: `/fonts/*` と `/icons/*` のキャッシュヘッダー。認証済みページやAPIのキャッシュ設定は変更しない。

元ファイルの分類は、41ファイルから必要な差分を採用、75ファイルは最新mainと一致、47ファイルは後続の修正を優先、5ファイルはローカル生成メタデータ、1ファイルは過去のセキュリティ調査記録として保持した。
[全169ファイルの判定](audits/local-work-recovery-20261003.csv)を参照。

## 採用しなかった差分

認証のラッパーやservice role制限の撤去、既存migrationの書き換え、テスト削除、記録一覧の遅延取得・ページ分割の撤去、古いE2E設定への変更は取り込まない。
Next.js 16.3.6とsharp 0.35.4は最新mainのバージョンを保つ。
旧セキュリティ調査報告は当時のHEADを対象とする記録であり、現行実装に対する再監査結果としては扱わない。

## 原本の復元

元の169ファイルはローカルのstashと `codex/local-snapshot-20261003` に保存した。
全ファイルをGitオブジェクトと原本でバイト単位に照合済み。未追跡ファイルはスナップショットの第3親に含まれる。
スナップショットはローカル専用とし、GitHubへpushしない。

現在の作業を保存した後、元のブランチで `git stash apply codex/local-snapshot-20261003` を実行すると復元できる。
元のブランチは `codex/local-work-preserved-20261003`。最新mainへ原本全体を適用しない。

## 検証

- `npm run typecheck`、`npm run lint -- --max-warnings=0`: 成功。
- `npm run test:unit`: 78ファイル、462テスト成功。
- `npm run test:ui`: 21ファイル、64テスト成功。
- `npm run build`、`npm run security:service-role`、`git diff --check`: 成功。
- E2Eと外部AIへの実送信・精度比較は未実施。DB migration・本番配備は行っていない。

実装前にContext7でNext.jsのServer Functionのエラー伝達、Google Gen AI SDKのVertex AI初期化と構造化出力、OpenAI Responses APIを確認した。
Next.js 16.3.6の同梱エラー処理ガイド、[OpenAI公式Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)も照合した。
