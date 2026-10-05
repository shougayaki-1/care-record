# 認証復旧・再ログインE2Eの調査（Issue #48）

## 初回失敗の切り分け

2026-10-05にGitHub Actionsのジョブログを確認した。診断として抽出したのは、対象テストのソース位置、固定のエラー種別、timeout、booleanの期待値／実測値だけであり、ログ本文、入力値、Cookie、token、traceの通信内容は本書に転載しない。

| CI run / project | 初回失敗 | 到達していない検証 |
| --- | --- | --- |
| [#34 / Chromium](https://github.com/shougayaki-1/care-record/actions/runs/37016149183) | recovery: `helpers.ts:51` の「作成して開始」クリックが15秒でtimeout。workspace-routing: `helpers.ts:66` の事業所準備pollが30秒でtimeout（trueを期待、false）。両方とも `setupNewOrg` 内。 | 所属なしアカウントからの復旧、既存アカウントの再ログイン |
| [#33初回 / Mobile Chrome](https://github.com/shougayaki-1/care-record/actions/runs/37083913243) | workspace-routing: `helpers.ts:66` の事業所準備pollが30秒でtimeout。 | 再ログイン後の所属解決 |
| [#33最終 / Chromium](https://github.com/shougayaki-1/care-record/actions/runs/37085059311) | recovery: `helpers.ts:49` の「事業所の作成」表示assertionが失敗。 | 所属なしアカウントからの復旧 |

行番号は各run当時のもの。いずれも最初の事業所fixtureを作る途中で失敗しており、ログからSETUP誤遷移や別アカウントの所属取り違えが発生したとは判断できない。#34は2件、#33初回と最終はそれぞれ1件がretryで成功した。

当時の `trace: 'on-first-retry'` はretry側を記録するため、初回失敗のイベント順序をtraceから確定することはできない。今回の分析は初回失敗のジョブログと当時のソースの照合による。資格情報を含み得るtraceは展開していない。

## 実装との照合と再現条件

#34の実行元 `75822d1d1c69b77a3c7bf1bd4fe5ff5c3f78da5f` のセットアップは、`INITIAL_SESSION` / `SIGNED_IN` / `TOKEN_REFRESHED` ごとに `processUser` を実行し、完了時にwizardを `choice` または `profile` に戻していた。

この実装で、事業所作成ステップへ進んだ後に同じユーザーの認証通知を受け取ると、作成フォームが消え、表示assertionまたはクリック待ちが失敗する。また、通知コールバック内で同じSupabase clientのクエリをawaitしていた。Supabase公式のtroubleshootingには、この実装形で後続APIが停止する問題が記載されている。両方ともfixture段階の停止と整合するが、過去runのログだけでどちらのイベント順序だったかまでは断定しない。

現在のbaseにはPR #54（`b0dd380`）の対策が既に含まれる。同じユーザーの通知でwizardを再初期化せず、クエリを認証コールバック終了後に実行する。Issue #48ではこの対策を重複実装しない。

回帰条件は `src/app/setup/page.test.tsx` で検査する。

- 作成ステップで事業所名を入力した後、同じユーザーの `INITIAL_SESSION` / `SIGNED_IN` / `TOKEN_REFRESHED` を再通知してもフォームと入力を保持する。
- 初期認証通知が同期的に返るまではSupabaseクエリを開始せず、その後プロフィール・所属を読み込んでwizardを表示する。

## ローカルで再現した別の競合

2026-10-06、現在のbaseでも厳密なfixtureのMobile Chrome実行が失敗した。事業所作成後に `/app` の遷移が `/setup` によって中断され、所属取得はHTTP 200・1件だった。診断ではmain frameの固定pathname、所属レスポンスのstatusと件数だけを確認し、資格情報・所属ID・レスポンス本文は記録しなかった。

`AuthForm` の登録成功時の1秒後の遷移タイマーが、画面を離れた後も実行されていた。ログイン画面のセッション検出が先に `/setup` へ進み、事業所作成を完了すると、旧フォームのタイマーが `/setup` に戻して正常遷移を中断する。また、登録応答自体がunmount後に届く場合にも新しいタイマーを作っていた。

修正前のユニットテストで「画面を離れた後のタイマー」「画面を離れた後の登録応答」の2件が失敗し、修正後は既存の登録後遷移を含む3件が成功した。タイマーをeffect cleanupで解除し、unmount後の認証応答による遷移を抑止する。既存の1秒の成功表示は維持する。

## このIssueの変更

`setupNewOrg` は、アプリ自身が `/app/record` へ遷移し、作成した事業所のselectorを表示するまで待つ。エラー画面の「再試行」を自動で押す処理と、途中の `/app` からテスト側で `page.goto('/app/record')` する処理を削除した。fixtureが成功した扱いになる前に、実際の所属解決・正常遷移が必要になる。

対象2テストのfixtureを固定名の `test.step` で区切った。所属なしの `/app` の検査はmain documentのcommitを観測してから、アプリ自身の `/setup` 遷移を待つ。SETUP防止、所属なし復旧、別アカウントの事業所selectorの既存assertionは維持する。retryやtimeoutの増加、固定sleep、skipは追加していない。認証・認可・RLS・監査・保持期間・migrationの変更はない。

`AuthForm` のタイマー・応答の寿命を修正し、登録とログインのStorybook storyも追加した。サーバーの認証処理はStorybook上でmockする。追加storyのaxe検査が検出した既存の `h1` → `h6` の飛びを、見た目を変えず `h2` とすることで修正した。レビュー用branchのVercel自動deployは無効にした。

## 反復検証の環境と範囲

使い捨てローカルSupabase runnerで、許可済みの所属なし復旧と再ログインの2シナリオに絞り、ChromiumとMobile Chromeで5回ずつ実行する。各回は新しいDBで、`E2E_PROJECT` の継承を解除し、`GITHUB_ACTIONS` を空にして既存configのretryを0にする。runnerの専用環境ガードは維持する。

```sh
env -u E2E_PROJECT GITHUB_ACTIONS= npm run test:e2e -- \
  tests/recovery.spec.ts tests/workspace-routing.spec.ts
```

runnerはspecパスのみ受け付けるため、checkout外の一時`npx` wrapperで実際のPlaywright起動に `--grep '再ログイン時にSETUPへ誤遷移しない|所属なしのアカウントからログアウトし'` を付けた。configとテスト本体のskip／retryは変更していない。

Supabase CLIは2.108.0を使用。Mac上でEdge RuntimeがBus errorで起動しなかったため、checkout外の一時CLI wrapperで `supabase start --exclude edge-runtime` のみ指定した。対象テストはEdge Functionsを使用しない。Auth・DB等は起動し、専用DBへの既存migrationのresetもrunnerに従って行う。本番環境、実データ、共有DBへのmigration、deployは使用しない。

修正前の最初の全spec実行は7件成功・1件失敗だった。対象2シナリオは両projectで成功したが、別の古いキャッシュ復旧ケースで開発サーバーが `/api/auth/recover` に `Unexpected end of JSON input` を返した。全specの安定性は確認済みとしない。対象だけに絞った次の実行はMobile Chromeのfixtureで失敗し、上記タイマーの修正に至った。

タイマー修正後、2026-10-06に次の5回を実行した。全回でPC 2件・mobile 2件が成功し、retryは0。合計PC 10件・mobile 10件、20件成功。

| 回 | Chromium | Mobile Chrome | 結果 | テスト時間 |
| --- | --- | --- | --- | --- |
| 1 | 2 / 2 | 2 / 2 | 成功 | 41.6秒 |
| 2 | 2 / 2 | 2 / 2 | 成功 | 43.0秒 |
| 3 | 2 / 2 | 2 / 2 | 成功 | 41.0秒 |
| 4 | 2 / 2 | 2 / 2 | 成功 | 43.9秒 |
| 5 | 2 / 2 | 2 / 2 | 成功 | 41.0秒 |

この5回の後に見出し階層を修正した。最終版の候補SHAと追加の対象E2E結果は、検証完了後に追記する。

## ローカル検査結果

2026-10-06、実サービスの資格情報を使わずに実行した結果。

| 検査 | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm run lint -- --max-warnings=0` | 成功 |
| `npm run test:unit` | 75ファイル／445件成功。worker数・時間上限は変更していない |
| `npm run test:ui` | 23ファイル／68件成功。axe有効、登録の確認メール表示とタブ切替を含む |
| `npm run build` | 成功（Next.js 16.3.6、33 static pages） |
| `npm run test:ci-scope` | 17件成功 |
| `npm run security:service-role` | 直接importの制限とledgerの10用途一致 |

`npm run build-storybook` も成功。最終版の追加E2Eは進行中。

## 外部ドキュメント確認

2026-10-05〜06にContext7でReactのeffect cleanup・非同期応答の無視、StorybookのApp Router query mock、およびPlaywrightのURL待機・web-first assertion（対象依存 `@playwright/test` 1.61系）、Supabaseの認証通知とコールバック制約（対象依存 `@supabase/supabase-js` 2.91系）を確認した。最新referenceとtroubleshootingではasync callbackの制約に記述差があるため、既存のコールバック外実行を維持した。

- [Playwright navigation](https://playwright.dev/docs/navigations)
- [Supabase onAuthStateChange](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Supabase APIが返らない場合](https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0)

- [React useEffect cleanup](https://react.dev/reference/react/useEffect)
- [Storybook Next.js navigation](https://storybook.js.org/docs/get-started/frameworks/nextjs-vite#nextjs-navigation)
