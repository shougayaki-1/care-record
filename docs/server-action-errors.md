# Server Action の想定済みエラー（Issue #39 / #45）

確認日: 2026-10-06。Context7のNext.js一次資料と、使用中のNext.js 16.3.6に同梱されたerror-handling資料を確認した。想定済み状態は戻り値で扱う。productionではthrowした詳細がReact/Next.jsに秘匿されるため、例外のmessageがクライアントへ届く前提にしない。

## 最終契約

- `ActionResult<T, Code>`: 正常値は`{ ok: true, data }`。想定済み状態は`{ ok: false, error: { code, message } }`。
- `withActionResult`は公開Action全体を`withSafeError`で包む。公開できるのはアプリが明示した`ExpectedActionError(code, 安全な文言)`だけ。
- `SAFE_MESSAGE_PATTERNS`と部分一致による公開判定を撤去した。`withSafeError`は裸のErrorや未分類のUserFacingErrorも汎用化し、元の詳細をサーバーログへ記録する。
- DB/SDKのエラーは`sanitizeDbError`/`sanitizeExternalError`で扱う。「権限」「見つかりません」などを含む内部エラーも公開しない。
- RPCの想定済み状態は、既存migrationに定義されたSQLSTATEと識別子の完全一致で判定する。公開文言はアプリの定型文言とし、DBのmessageを反射しない。未定義の組合せはDB障害として汎用化する。
- サーバー内の入れ子呼出しは`requireActionResult`でunwrapし、失敗値を成功値に包まない。
- クライアントは`readActionResult`でunwrapする。失敗はローカルの`ActionResultError`に変換する。戻り値が届かない通信失敗も固定の汎用文言にする。
- `getActionErrorMessage`はこのローカルクラスの文言だけを表示する。任意の例外のmessage/stackを画面へ反射しない。
- `needsActionRecovery`は未認証・セッション切れだけを対象とする。再認証証明の不足/失効/使用済みは`REAUTH_REQUIRED`、試行制限は`RATE_LIMITED`として区別する。

共通コード: `UNAUTHENTICATED`、`SESSION_EXPIRED`、`FORBIDDEN`、`VALIDATION_ERROR`、`NOT_FOUND`、`NOT_CONFIGURED`、`REAUTH_REQUIRED`、`RATE_LIMITED`、`STAFF_NOT_LINKED`、`VERSION_CONFLICT`、`UNEXPECTED_ERROR`。

## 移行済みの対象

Actionと全呼出し元をセットで移行した。

| 対象 | Action / UI |
| --- | --- |
| マスタ・スタッフ・利用者 | `serviceTypes.ts`、`staffRoles.ts`、`staffs.ts`、`clients.ts`のread/write、各管理・設定画面、区間入力 |
| ロール・事業所 | `roles.ts`、`organization.ts`、`organizationOwners.ts`、ロール管理・事業所設定・setup |
| アカウント・再認証 | `accounts.ts`、`user.ts`、`authSecurity.ts`、再認証開始/証明取得/heartbeat、招待・プロフィール・規約同意・アカウント管理 |
| シフト | 一覧/本人シフト、CRUD/区間保存、ひな形write、月次プレビュー/生成、各画面/hook/modal |
| 同期・接続・修復 | Google接続状態/URL、同期batch/単件/修復、スタッフ修復、設定画面・同期進捗hook |
| バックアップ・ログ | バックアップ状態/一覧/読取/実行、監査/Cloudログ、設定一括read、各画面 |
| 内勤・本人履歴 | `internalWork.ts`全Action、`recordFeed.ts`、履歴・内勤画面と保存dialog |
| 提供記録 | `reports.ts`全Action、autosave/版保存/承認/差戻し/論理削除/復元/画像/監査と全呼出し元 |
| 記録周辺 | AI候補read/承認、削除申請read/write、シフト紐付けread/write、AI取込・確認・記録編集 |
| GAS・労働時間・統計・platform | `gas.ts`、`laborPremium.ts`、`statistics.ts`、`super-admin.ts`、各設定/統計/platform画面 |

TypeScript compiler APIによる最終点検で、公開Action 136件が`withActionResult`を使用し、その本番呼出し163箇所を確認した。161箇所は共通unwrapを使用する。本人シフトの2箇所は`ok`分岐で型付き結果を直接処理する。

既存のdomain resultを持つ`loginWithPassword`、`registerWithPassword`、`getMyWorkspaces`は既存契約を維持し、想定済み状態と予期しない例外を安全な戻り値へ変換する。Authの判定にmessageの部分一致を使わない。`recordLogout`、`recordOAuthLogin`は監査のbest-effort用途で、失敗をサーバーログへ記録する既存void契約を維持する。旧rethrow型の公開業務Actionは残っていない。

## 失敗時の動作と保持する条件

認証helperはAuthのセッション欠落/拒否、活動記録の期限切れ、所属・権限なしを明示的に分類する。通信失敗、所属・ロール・活動記録等のDB照会失敗を、未所属・権限なし・期限切れと誤認しない。

正常0件と失敗を分離する。シフトのスタッフ照会失敗を未紐付けとせず、記録照会失敗を未記録としない。招待・所属・アカウント照会の障害を無効な招待・空一覧にしない。月次生成の既存記録/ひな形、同期対象/残件の照会失敗を正常0件・同期完了にしない。

主要read画面は常設エラーと再試行を提供し、認証/session切れの場合だけ共通復旧POSTを表示する。マスタ・ロール・内勤・履歴・統計等で失敗時に「設定なし」や空一覧を表示しない。本人シフトのスタッフ未紐付けには#39/#29の既存復旧導線を維持する。利用者選択では任意の補助情報である本人シフトの失敗が、独立した利用者一覧を破棄しない。

既存シフトの区間read失敗時は保存を停止する。保存拒否後もシフト・ひな形・内勤・提供記録のdialog/入力を保持し、再試行できる。内勤・提供記録・AI一括下書きは失敗後も冪等性キーを保持する。提供記録の`CR409`は`VERSION_CONFLICT`へ変換し、版/現在のrevision ID等のDB詳細を公開しない。競合後は入力を保持して再読み込み・差分確認を案内する。

シフト生成の部分成功とAI一括保存の行別成功/失敗は維持する。生のDB/SDK文言を失敗理由や同期エラー保存列へ公開しない。GASの失敗応答を成功値に包まず、成功時もfolder/doc等の利用する結果項目だけを返す。

認可・session期限・本人/組織scope・RLS・permissions、原子的RPC、監査・保持期間・論理削除・記録版管理・訂正・再認証証明の一回限り条件を維持している。DB/RLS/permissions/migrationの変更はない。通常業務のservice role追加もない。

## 検証

- `npm run typecheck`、`npm run lint -- --max-warnings=0`、production buildが成功。
- `npm run test:unit`: 110 files / 754 tests。正常0件、認証/所属/権限/DB障害の分離、RPC識別子の完全一致、旧判定語を含む内部エラーの秘匿、副作用抑止、入力/冪等性キー保持、再試行・scope切替を検証した。
- `npm run test:ui`: Storybook/a11y 29 files / 85 tests。共通UIと、主要read/writeの失敗・再試行・復旧を検証した。
- `npm run test:action-transport`: DB・ログイン・本番設定を使わない独立fixtureに実装中のhelper/logger/typesをコピーし、インストール済みNext.jsの`next build --webpack`と`next start`を実行した。実ブラウザから10回のServer Action POSTで正常0件・void成功・権限拒否・session切れ・再認証要求・試行制限・版競合・スタッフ未紐付け・汎用失敗・raw throwを検証した。code/message保持、レスポンス本文への内部詳細非露出、サーバーログ記録、production redactionを確認した。
- `npm run security:service-role`の台帳10用途と、`npm run test:ci-scope`の分類テスト17件も最終状態で成功。該当境界は変更していない。

HTTP fixtureで本文を全POST後に取得した初回はChromiumの古いresource body取得に失敗した。各POST直後に本文を取得する方式へ修正し、全10本文の非露出検証を維持して再実行した。

このHTTP fixtureは実DBの認可/RLS・ログインを含むE2Eではない。`npm run test:e2e`は専用Supabase環境とユーザー確認が必要なため未実行。環境変数は検証専用のダミー設定を使用し、実secretはworktreeへコピーしていない。
