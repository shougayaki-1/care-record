# 認証・画面表示エラーからの復旧

所属がないアカウントでは `/setup` の「別のアカウントでログインする」、所属情報の取得に失敗した場合は「ログアウトしてやり直す」からログインをやり直せます。セットアップの初期ロード中・招待コードエラー時にも操作できます。

`/setup` のアカウント切替導線には、現在の認証セッションにメールアドレスがあるときだけ「現在ログイン中: …」を補助表示します。初期ロード中とprofile / choice / create / joinの全段階で同じ表示コンポーネントを使い、セッション更新時にメールだけを更新します。追加の認証問い合わせ・保存処理は行いません。既存のログアウトフォームと独立復旧画面の処理は維持します。同じ「別のアカウントでログインする」導線の実画面は、現時点では`/setup`だけです。

画面が表示されない場合は、同じサイトの **`/api/auth/recover`** を直接開いて「ログアウトしてやり直す」を押してください。このページは通常のレイアウト・Provider・React の起動・認証情報の取得に依存しません。GET はログアウトせず、同一オリジンの POST だけでセッションを破棄します。

復旧時は監査記録・サーバー側セッション失効・Supabase global signOut を可能な範囲で実行します。各外部処理は2秒で待機を打ち切り、失敗しても対象プロジェクトの認証 Cookie（分割チャンク、PKCE、再認証用 Cookie を含む）を削除します。サービス側での失効に失敗した場合、他の端末のログアウトまで保証するものではありません。

POST 完了画面では、アプリのサイドバー状態と対象 Supabase プロジェクトの認証・ユーザーキャッシュだけを localStorage/sessionStorage から削除します。既存の `ServiceWorkerCleanup` と同じ方針で Service Worker と Cache Storage を整理し、`window.location.replace('/')` でページ全体を再読み込みします。JavaScript が無効な場合も Cookie を削除でき、ログイン画面へのリンクが表示されます。

復旧 GET とログアウト完了画面は、同じ中央寄せのカード・CareRecord 表記・全幅の主要操作を使います。nonce 付き inline CSS とブラウザのシステム色だけで表示し、ライト／ダーク配色とキーボードのフォーカス表示に対応します。狭い画面では説明文とボタンを折り返し、外部 CSS・フォント・画像には依存しません。

`error.tsx` はページ・子レイアウトのエラーを、`global-error.tsx` はルートレイアウト・Provider のエラーを扱います。再試行、再読み込み、ネイティブ POST によるログアウトを提供します。boundary 自体の JavaScript を読み込めない場合は、直接復旧ページを開いてください。

エラー分類（`chunk` / `hydration` / `runtime`）、boundary 種別、Next.js digest を `/api/auth/recovery-error` 経由で既存の構造化ログへ記録します。エラーメッセージ・スタック・URL・介護記録内容は送信しません。`labels.context = recovery` を運用ログで検索してください。

## 検証

ユニットテストはセットアップの各ステップ、Workspace エラー、boundary の再試行、監査/signOut のエラーとタイムアウト、対象キー/Cookie のみの削除を検証します。

`route.test.ts` は復旧 HTML と nonce CSP の回帰を、Storybook の `Auth/RecoveryFallback/ScreenWidths` は同じ静的 HTML の GET・完了画面を検証します。ブラウザテストの対象は幅240・320・375・1024px、ライト／ダーク配色の文字コントラスト、200%文字サイズ、横方向のはみ出しとキーボードフォーカスです。iframe 内では通常 UI の CSS・Provider を使わず、cleanup script とフォーム送信を実行しません。

Issue #57の確認（2026-10-06）: typecheck、lint（warning 0）、unit 74 files / 446 tests、Storybook 23 files / 69 tests、production buildが成功しました。メールあり・なし、ロード中、全4段階、セッション更新時の入力保持、ログアウト時の表示消去、240 / 320 / 375 / 960pxで長いメールの折り返しを検証しました。Context7でSupabaseの`onAuthStateChange`を確認し、Next.js 16.3.6同梱のClient Components文書も確認しました。対象SDKは`@supabase/supabase-js` 2.91系です。E2Eは明示確認待ちで未実行です。

専用テスト環境では `tests/recovery.spec.ts` で JavaScript 無効時の復旧、キャッシュ整理とページ全体の遷移、所属なしアカウントから別アカウントへの再ログインを確認できます。

```sh
npm run test:e2e -- tests/recovery.spec.ts
```

Docker Desktop・Supabase CLI・Playwright Chromium を用意してください。既存のローカルE2E runnerが一時Supabaseとアプリを起動し、テスト後に環境を破棄します。ホスト済み環境の認証情報は使用しません。

## 実装時のドキュメント確認

2026-10-02にContext7でNext.js App Routerのerror/global-errorとPOST Route Handlerを確認し、最新mainのNext.js 16.3.6同梱ドキュメントとも照合しました。再試行には16.3で安定化した `retry` を使っています。復旧UIはProvider・MUIの故障に備えたnative HTMLで、ブラウザのシステム色を使用します。

2026-10-04（Issue #58）にContext7でRoute Handlerの独立したResponseとinline style/scriptのCSP nonceを確認し、使用中のNext.js 16.3.6同梱ドキュメントと照合しました。復旧処理とCSPは維持し、静的HTMLの見た目だけを整えています。

2026-10-06（PR #82の最新main追従）にContext7でNext.jsのCSP nonceとRoute Handlerの独立Responseを再確認し、Next.js 16.3.6同梱のCSPガイドを参照した。現行の復旧処理とCSPを維持したまま文書の競合を解消した。

Issue #58の再検証（2026-10-06、base `c96b60cbdd1304ec1f02067ee27be4488cd1801d`）: `npm run typecheck`、`npm run lint -- --max-warnings=0`、`npm run test:unit`（90 files / 551 tests）、`npm run test:ui`（27 files / 78 tests）、`npm run build`、`npm run security:service-role`、`git diff --check`が成功した。静的HTMLをJavaScript無効で描画し、240pxライトの復旧、375pxダークの完了、1024pxライトの復旧のスクリーンショットも目視確認した。E2Eはローカル未実行。Supabase/Authはunitでmockし、実サービスへの接続は行っていない。
