# パスワード再設定・重要操作の本人確認（Issue #30）

ログイン画面の「パスワードを忘れた方」から `/auth/forgot-password` に移動し、メールを依頼する。登録有無、Authのエラー、送信制限によらず、外向けの完了文言は同じ。UIは60秒の再送待機、DBはメール単位の60秒間隔とメール/IP単位の15分5件制限を適用する。IP・メールはハッシュ化し、制限処理はDBのロック内で予約する。制限用DBが利用できない場合はメールを送信しない。

メールの `token_hash` は `/auth/recovery-callback` だけで `verifyOtp(type: 'recovery')` に渡す。通常ログインのcodeやOAuth codeは受け付けない。検証後は資格情報を含まない `/auth/reset-password` へ直ちにリダイレクトする。callbackはno-store/no-referrer。メールのリンクに必要な一時トークン以外に、token/code/passwordをアプリのログ・監査・永続ストレージに保存しない。アクセスログの管理側でもcallbackのqueryを記録しない設定を維持する。

検証済みのユーザーとセッションに紐づく `account_password_reset` 証明を既存の `reauth_grants` に発行し、10分のhttpOnly Cookieで保持する。新しいパスワードを2回入力し、サーバー側でポリシー・一致・証明の用途/期限/一回限り/セッションを検証して更新する。成功後は既存の共通ログアウト処理を使い、全画面遷移でログイン画面へ戻る。更新失敗時は証明が消費済みなので、新しいメールを依頼する。

`ReauthDialog` / `useReauth` は利用可能なパスワード・Google・Microsoftをサーバーから取得する。パスワードを設定済みでも、連携済みSSOを選べる。入力パスワードはReact stateだけに保持し、送信・失敗・キャンセル・方法変更で消す。キャンセル/30秒タイムアウト後の遅い応答は操作を再開しない。OAuth challengeは選択されたproviderが実際に紐づいている場合だけ発行する。戻り先は設定/プロフィールの2画面に限定し、同一ユーザー検証、一回限りのnonce、証明のTTL/用途/セッション紐づけを維持する。Azureでは`prompt=login`、Googleではアカウント選択を要求する。

Googleカレンダーの接続/再認可では、既存のGoogle主体照合つき認可を本人確認として使い、二重のOAuth画面を避ける。この方式はパスワードも持つGoogle利用者にも適用する。解除と事業所削除には共通ダイアログと証明を使う。

アカウントのパスワード変更・メール変更は用途別証明を消費するServer Actionを通す。OAuthで戻った場合は、秘密情報や変更メールを保存せず、画面で再入力して確定する。旧クライアントの再認証なし退会はmigration適用後に拒否されるため、退会操作には更新済みアプリへの再読み込みが必要。新規RPCは既存の論理削除・所属解除処理を維持する。

退会はDBのRPC自体で証明を消費し、旧引数のRPCのブラウザ実行権限を撤回するためブラウザからの直接呼び出しでも再認証を省略できない。Supabase Auth API自体のパスワード/メール更新ポリシーはSupabaseの設定に依存するため、アプリのstep-upだけでAuth APIへの直接アクセスを制限するものではない。

## ステージングへの導入

1. `20261002000001_password_recovery_reauth.sql` をステージングDBに適用する。
2. Supabase DashboardのAuthentication → Email Templates → Reset Passwordに、`supabase/templates/recovery.html` と同じ内容を設定する。標準のConfirmationURLテンプレートのままではこの専用フローを利用できない。
3. Authentication → URL Configurationに、ステージングの正確な `https://<staging-host>/auth/recovery-callback` と通常のreauth callbackを登録する。本番にも本番originの正確なURLを登録する。
4. `AUDIT_IP_HASH_SALT` を設定し、IP/メールのsalt付きハッシュを利用する。未設定時はメールのみSHA-256で制限する。
5. SMTP、Supabaseの送信制限、Google/Azureの認証設定を確認する。ローカルのテンプレート・callback許可URLは `supabase/config.toml` に追加済み。
6. ステージングで検証後に、通常のリリース手順で本番へ反映する。

## 検証

ユニットテストはpassword/Google/Azure/複数identity、未登録/送信制限、用途違い/期限切れ/セッション違い、OAuth別ユーザー、キャンセル、タイムアウト、パスワード欄の消去を確認する。`tests/password-recovery.spec.ts` はPC/モバイルの導線、不正/使用済みリンク、ローカルSMTPメール経由の再設定、未登録メールの同一応答と再送待機を確認する。

DBが起動した専用テスト環境では、マイグレーション後に `supabase/tests/password_recovery_reauth.test.sql` を実行する。テストはトランザクションでロールバックする。DBを使う通し確認では次を行う。

- 登録済み・未登録メールの応答が同じで、連打が制限される。
- メールを開いて再設定し、ログイン画面から新しいパスワードで入り直せる。
- 使用済み/期限切れ/不正リンクから変更できない。
- password-only / Google-only / Azure-only / password + Googleで重要操作を確認する。
- OAuthキャンセル、別アカウント選択、証明期限切れで重要操作が実行されない。
- 退会RPCに証明なし/別用途/別セッション/使用済み証明を渡しても退会できない。

ローカルSupabaseで空DBからのmigration適用、全pgTAP 106件、DB lintが成功した。専用のMailpitに届くメールからの再設定、新旧パスワードでのログイン、使用済みリンク拒否をPC/モバイルのE2E 8件で検証した。実Google/Azureとホスト済みSMTPの通し確認は、環境ごとの設定後にステージングで実施する。DB変更・Dashboard設定のホスト済み環境への適用はこのPRのマージには含まない。

reset制限と認証変更時の他端末セッション失効は、既存の限定用途accessorと操作台帳に登録する。認証変更は他端末のアプリセッションを失効し、Auth refresh tokenも失効させ、秘密情報を含まない用途別監査イベントを記録する。

Issue #29との分離のため、既存 `src/app/actions/auth.ts`、ログアウトutility、復旧endpoint、setup、error boundary、AppLayoutは変更していない。
