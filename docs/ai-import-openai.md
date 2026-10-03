# AI取込でGPT-6 Lunaを使う準備

AI取込の標準送信先はGeminiです。`AI_EXTRACT_PROVIDER=openai`を設定すると、同じ取込画面・確認画面からOpenAIのResponses APIを使います。送信先は画面のAI案内に表示されます。失敗時に別の事業者へ自動で再送しません。

## ローカルで切り替える

1. OpenAI PlatformでAPIキーを作成する。キーはこのリポジトリやチャットへ貼らない。
2. Git管理外の`.env.local`に次を設定する。既存のSupabase設定は維持する。

   ```dotenv
   AI_IMPORT_ENABLED=true
   AI_EXTRACT_PROVIDER=openai
   OPENAI_API_KEY=取得したAPIキー
   OPENAI_MODEL=gpt-6-luna
   ```

3. 開発サーバーを再起動し、AI取込画面の送信先表示が`OpenAI（gpt-6-luna）`になったことを確認する。
4. 個人情報を伏せた帳票で読み取り、原本と全項目を照合する。確認済みの記録だけ下書き保存する。

Geminiに戻す場合は`AI_EXTRACT_PROVIDER=gemini`を設定して再起動します。OpenAIのキーがなくてもGeminiは動作します。

PDFはページ画像を`high`の精細度で、写真は画像入力として送信します。構造化出力をフォーム項目に合わせて検証し、API応答の保存を`store: false`に設定しています。これはOpenAI側でデータが一切保持されないことを意味しません。外部送信とデータ取扱いは、利用組織の契約・設定に従って確認してください。

今回の移植では、OpenAIへの実送信とGeminiとの精度比較は未実施です。

参考: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[File inputs](https://developers.openai.com/api/docs/guides/file-inputs)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。
