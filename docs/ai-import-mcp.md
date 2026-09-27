# MCPによるAI取込候補

利用者が契約しているChatGPT Work・Codex・ClaudeなどでPDFを読み取り、CareRecordのMCPサーバーへ構造化した候補を送る。CareRecordはAI APIを呼び出さない。候補は記録本体とは別の `ai_import_candidates` に保存し、アプリの「AI取込候補」で原本照合・修正した後だけ下書きにする。

## 構成

1. AIクライアントがPDFを読み、`list_workspaces` で取込先事業所を確認する。
2. `get_record_form` でフィールドID、選択肢、読み取りルールを取得する。
3. `submit_record_candidate` で読み取り結果を送る。MCPサーバーは値の型・選択肢・日時を検証し、所属事業所だけに候補を作る。
4. 利用者がアプリの「AI取込候補」でPDF原本と照合する。原本PDFはAIチャット側にあり、CareRecordには候補データと申告されたファイル名だけが入る。
5. 確認した候補をサーバー側の `saveAiCandidateAsDraft` で下書き保存する。サーバーは候補の所有者と記録編集権限を検証し、`ai_import_provenance` にAI由来の証跡を記録する。記録編集画面の警告はこの証跡から表示し、成功後に候補を削除する。証跡保存や候補削除に失敗した場合、候補を残して再試行できる。

AIの自己評価や警告に誤読が現れないことがあるため、特記事項・日付・チェック・丸印は必ず人が確認する。MCPツールは承認済みの記録を作らない。

## 認証

Supabase AuthのOAuth 2.1サーバーを使う。`/oauth/consent` に既存ログインと同意画面を用意した。Supabase Edge Function `care-record-mcp` は `withOAuthProtectedResource` と `withSupabase({ auth: 'user' })` を使い、OAuthディスカバリ・トークン検証・利用者権限のクライアントを提供する。MCPにはService Roleキーを渡さない。

OAuthトークンはそのままだと通常の `authenticated` ロールを持ち、MCPツール以外のData APIも呼べる。Custom Access Token Hookで `client_id` を持つOAuthトークンを `mcp_import` ロールへ切り替える。このロールは `list_mcp_workspaces` と `submit_mcp_candidate` の実行権限だけを持ち、一般テーブルへの権限は持たない。候補登録RPCもロール・`client_id`・事業所所属・サイズ・件数を検証する。通常のアプリセッションは `authenticated` のまま。OAuthスコープ自体はDBアクセスを制限しない。

利用者は「AIアプリとの接続」でOAuth許可を確認・解除できる。解除すると更新トークンは失効するが、発行済みJWTは有効期限まで利用できる可能性がある。PDFや画像をAIサービスに添付する場合、原本の取り扱いはそのサービスの契約・設定にも依存するため、同意画面で明示している。

ローカルの `supabase/config.toml` でOAuthサーバーと動的クライアント登録を有効にしている。本番に接続する前に、Supabase Dashboardの **Authentication → OAuth Server** で同機能を有効にし、Authorization Pathを `/oauth/consent` に設定する。MCP Edge Functionの認証には非対称JWT署名鍵（ES256またはRS256）が必要。OAuth同意画面とMCPエンドポイントを公開HTTPSで提供する。

## 展開前の確認

- OAuth対応のSupabase CLI、Docker、非対称JWT署名鍵を用意する。今回使用したCLI 2.108.0ではローカルAuthのOAuth APIは動作したが、ゲートウェイ直下の公式発見URLは404だった。外部MCPクライアントの接続は公開環境で検証する。
- マイグレーション `20260926000001_mcp_ai_import_candidates.sql` と `20260927000001_isolate_mcp_oauth.sql` を順に適用し、`supabase/tests/mcp_role_security.sql` で実効権限を確認する。
- Edge Functionの環境変数 `APP_ORIGIN` にアプリの公開オリジンを設定する。例: `https://care.example.com`。未設定でも候補作成はできるが、MCPの応答に確認画面URLは付かない。
- **OAuth接続を有効化する前に**、本番Dashboardの Custom Access Token Hook を `public.mcp_access_token_hook` に設定し、発行したOAuthトークンの `role` が `mcp_import` になることを確認する。Hookが無効のままOAuthを公開すると、通常ユーザー権限のトークンが発行される。
- `supabase config push` で設定を反映し、Dashboardと公開OAuth発見URLでOAuthサーバー・Hookが実際に有効になったことを確認する。その後 `supabase functions deploy care-record-mcp` を行う。`verify_jwt = false` は未認証のOAuth発見リクエストを関数へ通すために必要で、各ツールは関数内でトークン検証を受ける。
- MCP URLは `https://<project-ref>.supabase.co/functions/v1/care-record-mcp`。ChatGPT Workの開発者モードとClaudeのカスタムコネクタに登録し、各サービスからOAuth接続を試す。
- MCP Inspectorで未認証リクエストの `401` と `WWW-Authenticate`、認証後の3ツール、他事業所への送信拒否を確認する。発行済みOAuthトークンでData APIの一般テーブルと `save_report_versioned` が拒否されることも確認する。
- AI取込の既存APIは `AI_IMPORT_ENABLED=false` のままにする。MCP候補機能はこのフラグに依存しない。

## フォーム定義

MCP関数は `supabase/functions/_shared/default-form-template.json` を返す。このJSONは `DEFAULT_TEMPLATE` から生成した。フォーム項目を変更したらJSONも更新する。`mcpFormTemplate.test.ts` が差分を検出する。

## 利用者向けの依頼文例

> 添付したサービス提供記録のPDFを読んでください。CareRecordの取込先事業所とフォームをMCPツールで確認し、読めた内容だけを候補として送ってください。チェックと丸印を別々に見て、読めない文字は推測せず警告にしてください。送信後は、CareRecordで原本照合が必要だと知らせてください。

## 公開後の手動確認

1. ChatGPT WorkまたはClaudeのMCP接続先に上記MCP URLを登録し、CareRecordへログインして同意画面で接続を許可する。
2. 個人情報を伏せたテストPDFを添付して上記の依頼文を送る。AIが3つのMCPツールを実行し、候補IDを返すことを確認する。
3. CareRecordの「AI取込候補」で原本を照合し、必要な修正後に確認済みへ変更して下書き保存する。
4. 保存した記録を開き、AI由来の警告が表示されることを確認する。最後に「AIアプリとの接続」で接続一覧と解除を確認する。

## 現時点の検証範囲

アプリの型検査・298件の単体テスト、MCP候補の入力検証テストを実施済み。ローカルDBでは2件のマイグレーションと権限検証SQLが通り、`mcp_import` が一般テーブル0件、公開RPCは指定の2件のみ実行可能で、通常ログインは候補を直接挿入できないことを確認した。ローカルのOAuth認可・同意・トークン交換で実際に `mcp_import` トークンを発行し、記録テーブル直読み403、MCPの3ツール成功を確認した。アプリ画面でも候補確認→下書き保存→証跡に基づく警告表示を確認した。テスト用の記録・候補・クライアントは削除し、監査ログが追記専用のため残る合成テスト事業所とユーザーは無効化した。ChatGPT Work・Claude Coworkからの実呼び出しは未検証。リンク済み本番ではOAuthサーバーが無効で、MCP用DBマイグレーション・Function・アプリの公開反映も未実施。

参考: [Supabase MCP認証](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)、[Supabase MCP展開](https://supabase.com/docs/guides/ai-tools/byo-mcp)、[OpenAIプラグイン認証](https://developers.openai.com/plugins/build/auth)
