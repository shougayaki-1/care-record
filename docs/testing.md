# テスト

Node.js 24、npm、Docker、Supabase CLI 2.108.0 を使用します。通常の変更では `feature/*` ブランチから PR を作成し、`.github/workflows/ci.yml` を実行します。最終判定には固定名の `CI` job を使います。CI は変更されたファイルに応じて追加の検査を選択し、選択されず省略された job は失敗とみなしません。

| 変更内容 | 自動検査 |
| --- | --- |
| アプリ・設定・テスト・workflow | lint、型、単体テスト、service role利用検査、本番build、CI判定範囲のテスト |
| DB・認可・DB連携コード | 空DBからのmigration、型生成差分、pgTAP、DB lint |
| migrationファイル | 上記に加えて既存DBからの更新試験 |
| UI component / Storybook | Storybook browser test |
| アプリ・DB・依存関係 | 主要E2E。E2Eテストファイル変更時は全E2E |
| 依存関係 | 本番依存のHigh/Critical監査、SBOM生成。監査は週次にも実行 |
| PR | secret scan |
| 文書だけ | secret scanと固定名の最終判定。重い検査は省略 |

基本コマンド:

```sh
npm ci
npm run lint -- --max-warnings=0
npm run typecheck
npm run test:ci-scope
npm run test:unit
npm run build
```

## 標準テスト

`npm run test` は既存の `npm run test:unit`（`src/**/*.test.{ts,tsx}`）と
`npm run test:ui`（Storybook の Chromium browser test）をこの順に実行します。
unit が失敗すると UI は開始せず、unit または UI の失敗は標準 test の非0終了コードに伝わります。
個別に実行する場合は引き続き `test:unit` / `test:ui` を使用できます。

事前に Node.js 24 と npm、依存関係、Playwright の Chromium を用意してください。
初回の依存関係・ブラウザのインストールにはネットワーク接続が必要です。

```sh
npm ci
npx playwright install chromium
export APP_ENV=test
export AI_IMPORT_ENABLED=false
export STORYBOOK_DISABLE_TELEMETRY=1
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-test-anon-key
export SUPABASE_SERVICE_ROLE_KEY=ci-test-service-role-key
npm run test
```

上記の値は CI と同じテスト専用のダミー値です。既存の retention unit は
DB 呼び出し前の拒否を検査しますが、import 時の client 初期化には URL と key が必要です。
実サービスの資格情報で置き換えないでください。

標準 test は unit とローカルの Storybook UI を対象とし、
Supabase の起動、DB migration、E2E、実際の外部サービス連携試験は実行しません。
Docker、Supabase CLI、実サービスの認証情報や環境ファイルは不要です。
`test:ci-scope`、lint、型検査、build も標準 test には含めず、上記の個別コマンドで実行します。
CI は引き続き変更分類に応じた個別の unit / UI job と並列 job を使用します。

DB 試験は Docker とローカル Supabase を準備し、対象と影響を確認して別途実行します。
実際の Google Calendar / Vertex AI / GCS 等への接続試験は標準 test の対象外です。
必要な場合だけ、承認された非本番の専用環境と合成データ・環境専用の認証情報を準備し、
実行範囲と外部接続を確認して実施します。本番サービス・本番データは使用しません。

`CI` workflow 内の固定名 check は `CI` です。`scope` が選んだ job だけが実行対象となり、
最終判定 job は条件付き job が `skipped` の場合も成功として扱います。
`main` のブランチ保護では、この `CI` を必須チェックに設定済みです。

UI 変更時は `npx playwright install chromium` の後、`npm run test:ui` を実行します。DB 変更時は [CI workflow](../.github/workflows/ci.yml) と同じ Supabase CLI 2.108.0 で、ローカルの migration、pgTAP、DB lint を確認します。共有環境に適用済みの migration は書き換えません。CI の変更分類に関するテストには `npm run test:ci-scope` を使います。

## E2E

E2E は標準 `npm run test` に含めません。ローカル DB の作成・migration 適用を伴うため、
専用環境と実行条件を確認し、ユーザーの確認を得てから実行してください。

`npm run test:e2e:critical` は、認証、組織のセットアップと再ログイン後の workspace 解決、記録保存、組織分離を中心に検査する Chromium テストです。`npm run test:e2e` はすべての E2E テストを実行します。どちらのコマンドも一時ディレクトリに専用の Supabase project ID と空きポートを用意し、現行 migration を適用して、合成アカウントでテストした後に環境を破棄します。開発用の `supabase/.temp` や DB はリセットしません。Supabase の API URL または DB URL にループバック以外を指定すると、開始前に失敗します。既存の localhost アプリも再利用しません。

実行時は Supabase CLI の出力から、一時 project の API URL と key を取得します。`.env.local` やクラウド E2E 用の secrets は不要です。linked project にも接続しません。

```sh
npm run test:e2e:critical
npm run test:e2e
```

特定の spec だけを再実行する場合は、たとえば
`node scripts/e2e/run-local.mjs all tests/setup.spec.ts` を使います。

Docker Desktop、Chromium、Supabase CLI 2.108.0 が必要です。E2E runner は `PATH` 上の `supabase` コマンドを実行します。CI では `supabase/setup-cli` と Playwright の browser install を使って準備します。ローカルに browser が入っていない場合は、初回に `npx playwright install chromium` を実行します。`E2E_TEST_ENV=true` は一時環境を作る runner が Playwright に渡す値なので、手動で設定して Playwright を直接実行しないでください。本番や Staging の認証情報は E2E に渡しません。

実行していない検査を「確認済み」と記録しないでください。CI の最終判定が失敗した場合は、選択された job のログを確認します。

## CI実行時間の短縮（Issue #42）

`scope` の変更分類を維持し、core の検査を `lint-security`、`typecheck`、`unit`、`build` の4ジョブで並列実行します。固定名の `CI` は、選択された4ジョブすべての成功を要求します。

full E2E は Chromium と Mobile Chrome を matrix の別 runner で並列実行します。各 runner は独立した一時 Supabase とアプリを用意し、各 project の全シナリオを維持します。critical E2E は Chromium のみです。`workers: 1` は維持します。片方が失敗しても他方の検査を継続し、最終判定は失敗になります。レポートは project 別 artifact に保存します。

ローカルの `npm run test:e2e` は引き続き両 project を実行します。単一 project には `E2E_PROJECT=chromium npm run test:e2e` または `E2E_PROJECT=mobile-chrome npm run test:e2e` を使います。

変更前後は同じ変更分類・イベントの成功 run を複数比較します。GitHub Actions の run 画面で全体と各 job の所要時間を確認できます。CLI では次の結果を保存し、run 開始から最後の job 終了までの経過時間と各 job の開始・終了差分を比較します。

```sh
gh run view RUN_ID --json startedAt,jobs > /tmp/ci-RUN_ID.json
```

runner 利用時間・`npm ci` 回数は増えます。短縮の実測値は変更後の GitHub Actions run 完了後に記録します。
