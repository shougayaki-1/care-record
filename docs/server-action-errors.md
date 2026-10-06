# Server Action の想定済みエラー（Issue #39 / #45）

確認日: 2026-10-04〜06。Context7 の Next.js 最新資料と、使用中の Next.js 16.3.6 に同梱された `10-error-handling.md` を確認した。
想定済みエラーは戻り値で扱う。production では throw したエラーの詳細が React/Next.js により秘匿されるため、安全な文言であっても `catch(e).message` に届く前提にしない。

## 契約と今回の範囲

- `src/types/actionResult.ts` の `ActionResult<T, Code>` は通常のデータとして transport する。
- `getMyShiftsWithStatus`: スタッフが存在しシフト0件なら `{ ok: true, data: [] }`。記録0件も正常値として各シフトの `report: null` を返す。
- スタッフ未紐付けは `{ ok: false, error: { code: 'STAFF_NOT_LINKED', message: ... } }`。文言は既存の定型文を維持し、画面は常設表示、再試行、Issue #29 の `RecoveryLogoutButton` を提供する。
- 同じ Action を呼ぶ記録作成の利用者選択画面も typed result を処理する。今日のシフトを任意の補助情報として扱う既存仕様を維持し、未紐付け・取得失敗でも独立した利用者一覧を表示する。
- 各 DB クエリの失敗は `sanitizeDbError` で詳細をサーバーログに残し汎用例外にする。スタッフ照会の失敗を未紐付けと誤認したり、記録照会の失敗を未記録と誤認したりしない。
- `withSafeError` と `UserFacingError` の既存の rethrow はサーバー内の互換性を維持するための契約であり、クライアントへのメッセージ伝送保証ではない。未移行 Action の契約は維持し、Action と全呼出し元をセットで段階移行する。
- `SAFE_MESSAGE_PATTERNS` は移行中のサーバー内互換性の判定に限る。部分一致した内部エラーを型付き結果の公開メッセージへ転用しない。
- クライアントは予期しない例外の message/stack を表示・記録せず、固定の汎用表示と再試行を提供する。

認証、session client、組織/本人のクエリ条件、RLS、監査、保持期間、記録履歴、migration は変更しない。所属なし・権限なしの拒否を成功扱いする変更も行わない。

## Issue #45 の段階移行

`withActionResult` は公開 Action 全体を `withSafeError(..., { strict: true })` で包む。
公開できるのはアプリが明示した `ExpectedActionError(code, 固定文言)` だけで、裸の `Error`、未分類の `UserFacingError`、DB/SDK 由来の文字列はログへ記録して `UNEXPECTED_ERROR` にする。
「権限」「見つかりません」などを含む内部エラーも公開しない。正常値は `{ ok: true, data }`、想定済み状態は `{ ok: false, error: { code, message } }` とする。

共通コードは `UNAUTHENTICATED`、`SESSION_EXPIRED`、`FORBIDDEN`、`VALIDATION_ERROR`、`NOT_FOUND`、`NOT_CONFIGURED`、`REAUTH_REQUIRED`、`RATE_LIMITED`、`UNEXPECTED_ERROR`。
`ActionResult<T, Code>` は #39 の固有コードも引き続き扱える。
サーバー内で移行済み Action を呼ぶ場合は `requireActionResult` で unwrap し、二重の envelope や失敗値を成功値に包むことを防ぐ。

クライアントは `readActionResult` で成功値を unwrap する。失敗値はローカルの `ActionResultError` に変換し、既存の async UI フローを維持する。
通信エラーなど戻り値が届かない例外は固定の汎用文言にする。`getActionErrorMessage` はこのローカルクラスの文言だけを表示し、任意の例外の message を表示しない。
`needsActionRecovery` は未認証・セッション切れだけを対象とし、権限拒否をログアウトへ誘導しない。

### 移行済みの対象

| 対象 | Action / UI |
| --- | --- |
| シフト入力マスタ | `getServiceTypes`、`getStaffRoles` と各モジュールの write、`ShiftSegmentEditor`、各設定画面 |
| スタッフ | `getStaffPositionPresets` と `staffs.ts` の write、スタッフ管理画面 |
| シフト | `getShifts`、`getShiftPatterns`、`getShiftSegments`、`shifts/crud.ts` の write、`saveShiftSegments`、管理画面・区間入力・各 hook |
| ロール | `getOrgRolesFull` と `roles.ts` の write、`RoleManagementPanel` |
| 同期・接続状態 | `getSyncStatus`、`getGoogleConnectionHealth`、同期進捗 hook・設定画面 |
| バックアップ | `getLastBackupRun`、`listDailyBackups`、`getBackupRecords`、バックアップ画面 |
| 利用者 | `getClientAssignmentPermissionHints` と `clients.ts` の write、利用者管理・設定画面 |
| アカウント・プロフィール・再認証 | `accounts.ts`、`user.ts`、`authSecurity.ts`、`organizationOwners.ts`、事業所 write、再認証開始・証明取得・heartbeatと全呼出し元 |
| ログ・設定一括読取 | `getAuditLogs`、`listCloudLogEntries`、`getSettingsSectionsData`、ログ・設定画面 |

認証 helper は Supabase Auth のセッション欠落/拒否、活動記録の期限切れ、所属・権限なしを明示的に分類する。
Auth の通信失敗、活動記録・所属・ロール照会の DB 失敗は汎用失敗とし、「未所属」「権限なし」「有効期限切れ」と誤認しない。
組織/本人/session の条件、session 有効期限、scope 判定は維持する。
同期状態の各 query の失敗は未接続・未同期0件に置き換えない。

シフト区間・マスタ読取、ロール一覧で失敗時の常設表示と再試行を提供し、認証・session の状態には既存の recovery POST を表示する。
読取失敗時に「設定なし」「ロールがありません」と表示しない。
既存シフトの区間読取に失敗した場合は保存を停止し、失敗値を空の区間として保存しない。

### 残る移行対象

シフトひな形 write/生成/同期 write、バックアップ実行、内勤記録などの旧契約は引き続き移行する。
記録保存は版管理・競合・RPC の契約と全呼出し元を合わせて確認する。
未移行のサーバー内呼出しとの互換性のため、`withSafeError` の非 strict 経路には旧 `SAFE_MESSAGE_PATTERNS` を残す。
型付き結果への変換ではこの部分一致判定を使用しない。全移行後の旧判定撤去は #45 で追跡し、今回の段階だけで Issue を完了扱いしない。

## 検証範囲

Action unit は正常0件、シフト/記録あり・記録なし、未紐付け、各 DB クエリ失敗、予期しない例外を検査する。
同梱の production React Flight encoder/decoder で Action の戻り値を action-result promise として往復させ、未紐付けの code/message が保持されることと、throw の詳細が秘匿される対照ケースを検査する。
画面 unit は empty state、未紐付けと既存 recovery POST、予期しない失敗の固定文言と再試行を検査する。
このローカル検証は Next HTTP・ログイン・実 DB を含む E2E ではない。E2E は専用環境と承認を伴う別検証として扱う。


2026-10-06 の検証結果: `npm run typecheck`、`npm run lint -- --max-warnings=0`、`npm run build`が成功。`npm run test:unit`は76 files / 455 tests、`npm run test:ui`は22 files / 66 testsが成功した。production Flightの往復試験にはインストール済みNext.js 16.3.6のencoder/decoderを使用し、想定済み状態のcode/message保持と、throwされた内部詳細の秘匿を両方確認した。service-roleの用途台帳は10用途が一致し、CI分類テスト17件も成功。DB/RLS/permissionsの変更はない。実HTTP・ログイン・DBを含むE2Eは明示確認待ちで未実行。


Issue #45 の段階移行では、server/client helper、認証・所属・DB失敗の分離、マスタ0件、更新拒否後の副作用抑止、シフト管理、同期UI、Storybookの再試行・復旧を検査する。
`npm run test:action-transport` は DB・ログイン・環境変数を使わない専用 fixture に実装中の result helper と logger をコピーし、インストール済み Next.js の `next build --webpack` と `next start` を実行する。
実ブラウザから8回の Server Action POST を行い、正常0件・voidの成功・権限拒否・session切れ・再認証要求・試行制限・汎用失敗の戻り値、内部詳細の秘匿、サーバーログ記録、throw の production redaction を検査する。
これは実 DB の認可/RLS を含む `test:e2e` とは別の transport 検証であり、専用 Supabase の E2E は実行しない。


2026-10-06 の #45 検証結果: `npm run typecheck`、`npm run lint -- --max-warnings=0`、`npm run build` が成功。`npm run test:unit` は96 files / 668 tests、`npm run test:ui` は29 files / 84 testsが成功。`npm run test:action-transport` のproduction HTTP検証も成功。service-roleの用途台帳10用途とCI分類テスト17件も成功した。build・UIの初回失敗はフォント取得制限、worktreeの依存symlink、既存Auth story用の公開設定不足によるもので、独立した依存ディレクトリとダミー設定で再検証した。新しいstoryで確認したselectのラベル関連付け、ボタン名・コントラスト、空の表ヘッダーも修正し、a11y検査を通過した。
認可・session条件、RLS、permissions.ts、監査・保持期間・記録履歴、migration の変更はない。認可 helper のエラー分類は変更したが、許可条件は維持している。専用SupabaseのE2Eは未実行。

### アカウント・再認証の追加移行

`accounts.ts`、`user.ts`、`authSecurity.ts`、`organizationOwners.ts`、事業所のwrite、再認証開始・証明取得・heartbeatと全呼出し元を型付き結果へ移行した。
`REAUTH_REQUIRED` は証明の不足・失効・使用済みを示し、ログインセッション切れとは分ける。`RATE_LIMITED` は再認証の試行制限を示す。どちらも共通ログアウトの自動誘導対象にはしない。
再認証の条件付きUPDATE、本人/session/用途/期限/一回限りの条件、owner追加の原子的RPC、監査・保持・権限判定は維持する。
再認証方法・招待プレビュー・所属・アカウント一覧のDB/SDK失敗を、方法なし・無効な招待・未所属・空一覧へ置き換えない。既存参加者の招待も事業所IDが取れない場合は失敗とする。
アカウント一覧と招待プレビューには常設エラーと再試行を設け、アカウント一覧の認証失敗だけに共通復旧POSTを表示する。規約同意失敗時もダイアログを維持し、安全な文言と必要な復旧を表示する。
共通`useFetchData`は失敗を保持し、再試行・組織切替でリセットする。任意の例外文言をerror callbackへ返さない。
ログイン・登録・workspaceの既存のdomain resultは維持し、例外経路も固定の失敗値へ変換する。AuthエラーはSDKの`error.code`で判定し、文言の部分一致を使わない。パスワード再設定要求のアカウント存在を明かさない応答は維持する。
旧判定の撤去、シフト生成・同期write、記録・バックアップなどの残りは引き続き#45で追跡する。

追加移行の検証: `typecheck`、警告0の`lint`、unit 100 files / 701 tests、Storybook/a11y 29 files / 84 tests、production buildが成功。HTTP transportは再認証要求・試行制限・void成功を含む8回のPOSTで成功した。DB・RLS・permissions・migrationは変更していない。専用SupabaseのE2Eは未実行。
