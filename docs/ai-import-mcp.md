# MCPによるAI記録送信

職員が契約しているAIアプリでPDFを読み取り、CareRecordのMCPサーバーへ結果を送る。送信内容は `ai_import_candidates` に保持し、提供記録一覧の「AI送信・要確認」と管理者の確認待ちに表示する。管理者が内容を照合・修正して承認すると、提供記録を作成し、AI由来の証跡を残す。職員による下書き保存と再送信は不要。

## 構成

1. AIクライアントがPDFを読み、`list_workspaces` で取込先事業所を確認する。
2. `get_record_form` でフィールドID、印刷される質問、選択肢、読み取りルールと、接続した本人に紐づくスタッフ名だけを取得する。スタッフ名は照合ヒントであり、原本の記載を優先する。
3. `submit_record_candidate` で読み取り結果を検査する。読めなかった箇所があれば、質問と候補選択肢、自由記入の許可を返す。AIアプリで利用者に尋ねて結果を修正し、再実行する。利用者が先に送信したい場合は `send_anyway=true` で警告を残して送れる。
4. 送信結果は「送信済み」として職員の履歴、管理者の提供記録一覧に表示する。管理者が確認画面で原本、項目、交通費を照合・修正し、「内容を確認して承認」を押す。
5. サーバーは管理権限と記録の作成・承認権限を確認し、提出内容から記録を作成・承認する。`ai_import_provenance` に送信者と承認者の証跡を残し、候補を確認待ちから除く。

AIの自己評価や警告に誤読が現れないことがあるため、特記事項・日付・チェック・丸印は必ず人が確認する。MCPツール自体は承認済みの記録を作らない。現在、原本PDFはAIチャット側にあり、CareRecordには読み取り結果と申告されたファイル名だけが入る。

## 認証

Supabase AuthのOAuth 2.1サーバーを使う。`/oauth/consent` に既存ログインと同意画面を用意した。Supabase Edge Function `care-record-mcp` は `withOAuthProtectedResource` と `withSupabase({ auth: 'user' })` を使い、OAuthディスカバリ・トークン検証・利用者権限のクライアントを提供する。MCPにはService Roleキーを渡さない。

OAuthトークンはそのままだと通常の `authenticated` ロールを持ち、MCPツール以外のData APIも呼べる。Custom Access Token Hookで `client_id` を持つOAuthトークンを `mcp_import` ロールへ切り替える。このロールは `list_mcp_workspaces`、本人のスタッフ名だけを返す `get_mcp_self_staff_names`、`submit_mcp_candidate` の実行権限だけを持ち、一般テーブルへの権限は持たない。候補登録RPCもロール・`client_id`・事業所所属・サイズ・件数を検証する。通常のアプリセッションは `authenticated` のまま。OAuthスコープ自体はDBアクセスを制限しない。

利用者はアカウント設定の「AIアプリとの接続」でOAuth許可を確認・解除できる。解除すると更新トークンは失効するが、発行済みJWTは有効期限まで利用できる可能性がある。PDFや画像をAIサービスに添付する場合、原本の取り扱いはそのサービスの契約・設定にも依存するため、同意画面で明示している。

ローカルの `supabase/config.toml` でOAuthサーバーと動的クライアント登録を有効にしている。本番に接続する前に、Supabase Dashboardの **Authentication → OAuth Server** で同機能を有効にし、Authorization Pathを `/oauth/consent` に設定する。MCP Edge Functionの認証には非対称JWT署名鍵（ES256またはRS256）が必要。OAuth同意画面とMCPエンドポイントを公開HTTPSで提供する。

## 展開前の確認

- OAuth対応のSupabase CLI、Docker、非対称JWT署名鍵を用意する。今回使用したCLI 2.108.0ではローカルAuthのOAuth APIは動作したが、ゲートウェイ直下の公式発見URLは404だった。外部MCPクライアントの接続は公開環境で検証する。
- マイグレーション `20260926000001_mcp_ai_import_candidates.sql`、`20260927000001_isolate_mcp_oauth.sql`、`20260927000002_ai_sent_review.sql`、`20260927000003_ai_review_rollout_compat.sql` を順に適用し、`supabase/tests/mcp_role_security.sql` で実効権限を確認する。`00003` は旧アプリの下書き保存が候補削除を必要とするための切替用権限で、新アプリの稼働確認後に別migrationで廃止する。
- Edge Functionの環境変数 `APP_ORIGIN` にアプリの公開オリジンを設定する。例: `https://care.example.com`。未設定でも候補作成はできるが、MCPの応答に確認画面URLは付かない。
- **OAuth接続を有効化する前に**、本番Dashboardの Custom Access Token Hook を `public.mcp_access_token_hook` に設定し、発行したOAuthトークンの `role` が `mcp_import` になることを確認する。Hookが無効のままOAuthを公開すると、通常ユーザー権限のトークンが発行される。
- `supabase config push` で設定を反映し、Dashboardと公開OAuth発見URLでOAuthサーバー・Hookが実際に有効になったことを確認する。その後 `supabase functions deploy care-record-mcp` を行う。`verify_jwt = false` は未認証のOAuth発見リクエストを関数へ通すために必要で、各ツールは関数内でトークン検証を受ける。
- MCP URLは `https://<project-ref>.supabase.co/functions/v1/care-record-mcp`。ChatGPT Workの開発者モードとClaudeのカスタムコネクタに登録し、各サービスからOAuth接続を試す。
- MCP Inspectorで未認証リクエストの `401` と `WWW-Authenticate`、認証後の3ツール、他事業所への送信拒否を確認する。発行済みOAuthトークンでData APIの一般テーブルと `save_report_versioned` が拒否されることも確認する。
- AI取込の既存APIは `AI_IMPORT_ENABLED=false` のままにする。MCP候補機能はこのフラグに依存しない。

## フォーム定義

MCP関数は `supabase/functions/_shared/default-form-template.json` を返す。このJSONは `DEFAULT_TEMPLATE` から生成した。フォーム項目を変更したらJSONも更新する。`mcpFormTemplate.test.ts` が差分を検出する。

## 利用者向けの依頼文例

> 添付したサービス提供記録のPDFを読んでください。CareRecordの取込先事業所とフォームをMCPツールで確認してください。チェックと丸印を別々に見て、読めない箇所は推測せず、選択肢と自由記入で私に質問してください。分からないまま送る場合は警告を残して管理者へ送信してください。

## 公開後の手動確認

1. ChatGPT WorkまたはClaudeのMCP接続先に上記MCP URLを登録し、CareRecordへログインして同意画面で接続を許可する。
2. 個人情報を伏せたテストPDFを添付して上記の依頼文を送る。AIが3つのMCPツールを実行し、候補IDを返すことを確認する。
3. 読めない箇所について質問が返ること、回答後に送信できること、「このまま送信」もできることを確認する。
4. 職員の「自分の履歴」に送信済み、管理者の「提供記録一覧」にAI送信・要確認が表示されることを確認する。
5. 管理者が内容と交通費を確認して承認し、承認済みの記録とAI取込の証跡を確認する。最後にアカウント設定の「AIアプリとの接続」で接続一覧と解除を確認する。

## 検証

変更ごとに型検査、AI確認画面のテスト、DB権限テスト、MCPからの質問・送信、管理者の承認導線を確認する。MCPクライアント側の質問UIはクライアントの対応状況に依存するため、選択肢と自由記入をテキストでも提示する。

参考: [Supabase MCP認証](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)、[Supabase MCP展開](https://supabase.com/docs/guides/ai-tools/byo-mcp)、[OpenAIプラグイン認証](https://developers.openai.com/plugins/build/auth)
