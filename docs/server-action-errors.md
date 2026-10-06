# Server Action の想定済みエラー（Issue #39）

確認日: 2026-10-04〜06。Context7 の Next.js 最新資料と、使用中の Next.js 16.3.6 に同梱された `10-error-handling.md` を確認した。
想定済みエラーは戻り値で扱う。production では throw したエラーの詳細が React/Next.js により秘匿されるため、安全な文言であっても `catch(e).message` に届く前提にしない。

## 契約と今回の範囲

- `src/types/actionResult.ts` の `ActionResult<T, Code>` は通常のデータとして transport する。
- `getMyShiftsWithStatus`: スタッフが存在しシフト0件なら `{ ok: true, data: [] }`。記録0件も正常値として各シフトの `report: null` を返す。
- スタッフ未紐付けは `{ ok: false, error: { code: 'STAFF_NOT_LINKED', message: ... } }`。文言は既存の定型文を維持し、画面は常設表示、再試行、Issue #29 の `RecoveryLogoutButton` を提供する。
- 同じ Action を呼ぶ記録作成の利用者選択画面も typed result を処理する。今日のシフトを任意の補助情報として扱う既存仕様を維持し、未紐付け・取得失敗でも独立した利用者一覧を表示する。
- 各 DB クエリの失敗は `sanitizeDbError` で詳細をサーバーログに残し汎用例外にする。スタッフ照会の失敗を未紐付けと誤認したり、記録照会の失敗を未記録と誤認したりしない。
- `withSafeError` と `UserFacingError` の既存の rethrow はサーバー内の互換性を維持するための契約であり、クライアントへのメッセージ伝送保証ではない。既存 Action 全面の戻り値変更は行わない。
- `SAFE_MESSAGE_PATTERNS` は移行中のサーバー内互換性の判定に限る。部分一致した内部エラーを型付き結果の公開メッセージへ転用しない。
- クライアントは予期しない例外の message/stack を表示・記録せず、固定の汎用表示と再試行を提供する。

認証、session client、組織/本人のクエリ条件、RLS、監査、保持期間、記録履歴、migration は変更しない。所属なし・権限なしの拒否を成功扱いする変更も行わない。

## 横断調査と後続作業候補

`src/app/actions` の `UserFacingError` / `withSafeError` / `throw` と、`src/app/app`・関連 client component の例外メッセージ表示を検索した。
以下はこの Issue の自分のシフト以外で、同じ transport 前提が残る確認済み箇所。後続の移行は既存の [Issue #45](https://github.com/shougayaki-1/care-record/issues/45) で追跡する。#45に記載された旧ファイル名・旧helperの前提は、この文書の最終実装契約を参照して読み替える。

| 対象 | Action / 想定済み状態 | client 側の表示経路 | 後続作業 |
| --- | --- | --- | --- |
| ログ読取 | `organization.ts`: `getAuditLogs` / `listCloudLogEntries`。`assertOrgPermission` が認証・所属・権限を拒否 | `app/logs/page.tsx`: `setMessage(e.message)` | 認証・権限の型付き状態と汎用失敗を分離。外部 SDK 詳細も公開しない |
| シフト入力用マスタ読取 | `serviceTypes.ts`: `getServiceTypes`、`staffRoles.ts`: `getStaffRoles`。認可の拒否 | `ShiftSegmentEditor.tsx`: `setError(reason.message)` | typed result へ段階移行し、読取失敗とマスタ0件を区別 |
| スタッフ読取 | `staffs.ts`: `getStaffPositionPresets`。認可の拒否 | `app/staff/page.tsx` → `useFetchData` → toast に取得失敗メッセージ | 読取の型付き状態と汎用失敗を分離 |
| スタッフ更新 | `staffs.ts`: `softDeleteStaff` / `saveStaffPositionPreset`。対象なし、理由・役職名の検証 | `app/staff/page.tsx`: `showToast(e.message)` | 更新系の検証・業務状態を型付き結果へ移行 |
| アカウント更新 | `accounts.ts`: `createInvitation` / `removeAccount`。スタッフ紐付けなし、対象メンバーなし、入力・権限の拒否 | `app/accounts/page.tsx`: `showToast(e.message)` | 想定済み状態を typed result へ移行 |
| プロフィール更新 | `user.ts`: 名前検証、所属拒否、`deleteUserAccount` の再認証要求 | `app/profile/page.tsx`: `setMessage` / toast の例外文言 | Action とブラウザ Auth 呼出しを分けて transport を整理 |

`internalWork.ts` の `getMyInternalWorkHistory` は自分のスタッフなし・閲覧 scope なしで既に `[]` を返す。認証・所属拒否は throw のままなので、後続移行時に正常な履歴0件と区別する。
`clients.ts` / `shifts/crud.ts` 等にも対象なし・検証・所属不整合の throw がある。汎用エラー表示の client でも業務コードを判定できないため、各 Action と全呼出し元をセットで段階移行する。

## 検証範囲

Action unit は正常0件、シフト/記録あり・記録なし、未紐付け、各 DB クエリ失敗、予期しない例外を検査する。
同梱の production React Flight encoder/decoder で Action の戻り値を action-result promise として往復させ、未紐付けの code/message が保持されることと、throw の詳細が秘匿される対照ケースを検査する。
画面 unit は empty state、未紐付けと既存 recovery POST、予期しない失敗の固定文言と再試行を検査する。
このローカル検証は Next HTTP・ログイン・実 DB を含む E2E ではない。E2E は専用環境と承認を伴う別検証として扱う。


2026-10-06 の検証結果: `npm run typecheck`、`npm run lint -- --max-warnings=0`、`npm run build`が成功。`npm run test:unit`は76 files / 455 tests、`npm run test:ui`は22 files / 66 testsが成功した。production Flightの往復試験にはインストール済みNext.js 16.3.6のencoder/decoderを使用し、想定済み状態のcode/message保持と、throwされた内部詳細の秘匿を両方確認した。service-roleの用途台帳は10用途が一致し、CI分類テスト17件も成功。DB/RLS/permissionsの変更はない。実HTTP・ログイン・DBを含むE2Eは明示確認待ちで未実行。
