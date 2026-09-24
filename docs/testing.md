# テスト

Node.js 24、npm、Docker、Supabase CLI 2.108.0 を使用する。通常の変更は `feature/*` のPRで `.github/workflows/ci.yml` を実行し、固定名の `CI` jobを最終判定にする。CIは変更パスに応じて重い検査を選ぶ。省略されたjobは失敗扱いにしない。

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

`CI` workflow内の固定名checkは `CI`。`scope`が選んだjobだけが実行対象となり、
最終判定jobは条件付きjobが `skipped` の場合も成功として扱います。
`.github/workflows/ci.yml`をrequired checkに設定します。

UI変更時は `npx playwright install chromium` の後、`npm run test:ui` を実行します。DB変更時は [CI workflow](../.github/workflows/ci.yml) と同じSupabase CLI 2.108.0でローカルのmigration、pgTAP、DB lintを確認します。既存の共有migrationは書き換えません。CIの変更分類に関するテストは `npm run test:ci-scope` です。

## E2E

`npm run test:e2e:critical` は認証、組織セットアップと再ログイン後のworkspace解決、記録保存、組織分離を中心にしたChromium検査、`npm run test:e2e` は全件検査です。両コマンドは一時ディレクトリに別のSupabase project IDと空きポートを作り、現行migrationを適用し、合成アカウントで試験して終了後に破棄します。開発用の `supabase/.temp` やDBをリセットしません。Supabase API・DB URLにループバック以外を指定すると開始前に失敗します。既存のlocalhostアプリも再利用しません。

実行時はSupabase CLIの出力からその一時ProjectのAPI URLとキーを取得します。`.env.local`やクラウドE2E用のSecretsは必要なく、linked projectにも接続しません。

```sh
npm run test:e2e:critical
npm run test:e2e
```

特定のspecだけを再実行する場合は、たとえば
`node scripts/e2e/run-local.mjs all tests/setup.spec.ts` を使います。

Docker Desktop、Chromium、Supabase CLI 2.108.0が必要です。E2E runnerは`supabase`コマンドをPATHから実行します。CIでは`supabase/setup-cli`とPlaywrightのbrowser installで準備します。ローカルでbrowserが未導入なら、初回に`npx playwright install chromium`を実行します。`E2E_TEST_ENV=true` は一時環境を作るrunnerがPlaywrightへ渡す値なので、手動で設定してPlaywrightを直接実行しません。本番やStagingの認証情報はE2Eに渡しません。

実行しなかった検査を「確認済み」と記録しない。CIの最終判定が失敗した場合は、選択されたjobのログを確認する。
