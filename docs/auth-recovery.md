# 認証・画面表示エラーからの復旧

所属がないアカウントでは `/setup` の「別のアカウントでログインする」、所属情報の取得に失敗した場合は「ログアウトしてやり直す」からログインをやり直せます。セットアップの初期ロード中・招待コードエラー時にも操作できます。

画面が表示されない場合は、同じサイトの **`/api/auth/recover`** を直接開いて「ログアウトしてやり直す」を押してください。このページは通常のレイアウト・Provider・React の起動・認証情報の取得に依存しません。GET はログアウトせず、同一オリジンの POST だけでセッションを破棄します。

復旧時は監査記録・サーバー側セッション失効・Supabase global signOut を可能な範囲で実行します。各外部処理は2秒で待機を打ち切り、失敗しても対象プロジェクトの認証 Cookie（分割チャンク、PKCE、再認証用 Cookie を含む）を削除します。サービス側での失効に失敗した場合、他の端末のログアウトまで保証するものではありません。

POST 完了画面では、アプリのサイドバー状態と対象 Supabase プロジェクトの認証・ユーザーキャッシュだけを localStorage/sessionStorage から削除します。既存の `ServiceWorkerCleanup` と同じ方針で Service Worker と Cache Storage を整理し、`window.location.replace('/')` でページ全体を再読み込みします。JavaScript が無効な場合も Cookie を削除でき、ログイン画面へのリンクが表示されます。

`error.tsx` はページ・子レイアウトのエラーを、`global-error.tsx` はルートレイアウト・Provider のエラーを扱います。再試行、再読み込み、ネイティブ POST によるログアウトを提供します。boundary 自体の JavaScript を読み込めない場合は、直接復旧ページを開いてください。

エラー分類（`chunk` / `hydration` / `runtime`）、boundary 種別、Next.js digest を `/api/auth/recovery-error` 経由で既存の構造化ログへ記録します。エラーメッセージ・スタック・URL・介護記録内容は送信しません。`labels.context = recovery` を運用ログで検索してください。

## 検証

ユニットテストはセットアップの各ステップ、Workspace エラー、boundary の再試行、監査/signOut のエラーとタイムアウト、対象キー/Cookie のみの削除を検証します。

専用テスト環境では `tests/recovery.spec.ts` で JavaScript 無効時の復旧、キャッシュ整理とページ全体の遷移、所属なしアカウントから別アカウントへの再ログインを確認できます。

```sh
npm run test:e2e -- tests/recovery.spec.ts
```

Docker Desktop・Supabase CLI・Playwright Chromium を用意してください。既存のローカルE2E runnerが一時Supabaseとアプリを起動し、テスト後に環境を破棄します。ホスト済み環境の認証情報は使用しません。

## 実装時のドキュメント確認

2026-10-02にContext7でNext.js App Routerのerror/global-errorとPOST Route Handlerを確認し、最新mainのNext.js 16.3.6同梱ドキュメントとも照合しました。再試行には16.3で安定化した `retry` を使っています。復旧UIはProvider・MUIの故障に備えたnative HTMLで、ブラウザのシステム色を使用します。
