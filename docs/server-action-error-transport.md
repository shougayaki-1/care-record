# Server Action のエラー伝達（Issue #39）

2026-10-03にContext7とNext.js 16.3.6の同梱ドキュメントで再確認し、最新mainの記録フィード更新・古いレスポンス排除を維持して移植した。
[Expected errors](https://nextjs.org/docs/app/getting-started/error-handling)
は Server Function の戻り値として扱う。production では throw した Error の
message が秘匿されるため、利用者向け例外の rethrow による表示を保証できない。

## 今回の契約

- `src/utils/actionResult.ts` の `ActionResult<T>` をクライアント向け戻り値にする。
- `withActionResult` は `UserFacingError` のみを明示した code / message に変換する。
- その他の例外・DBエラーはサーバーログへ詳細を記録し、`UNEXPECTED_ERROR` と汎用メッセージを返す。
- 部分一致の `isSafeMessage` は新しい結果変換では使用しない。
- `withSafeError` は旧APIとの互換性のため残す。例外サニタイズ用であり、クライアントへの message 伝達契約ではない。
- code を追加する場合はクライアント公開用の型へ追加する。生のDBエラー文言を `UserFacingError` に渡さない。

`getMyShiftsWithStatus` を移行した。スタッフ未紐付けは `STAFF_NOT_LINKED`、
シフト0件・記録0件はsuccessとし、スタッフ・シフト・記録のクエリエラーはいずれも汎用結果にする。
「自分のシフト」はpersistent alertと再試行を表示し、スタッフ未紐付けでは
#29 の `RecoveryLogoutButton` を使う。「記録を作成」は利用者一覧の取得を維持し、
シフトのエラーをalertに表示して「自分のシフトで確認」へ接続する。
transport自体がrejectした場合も、例外messageをUIに反射しない。

## 横断調査と後続対応

残存箇所の移行は [後続Issue #45](https://github.com/shougayaki-1/care-record/issues/45) で追跡する。

`rg -n 'withSafeError|UserFacingError|isSafeMessage' src/app/actions src/utils` でActionを列挙し、
呼び出し元の `src/components`, `src/hooks`, `src/app/app` のcatchとmessage表示を照合した。
今回の移行以外には次の対象が残る。

| Action | 呼び出し元と現状 |
| --- | --- |
| `getServiceTypes`, `getStaffRoles` | `ShiftSegmentEditor`, `ServiceTypeSettings`, `StaffRoleSettings` が例外messageを表示。認可失敗がredactionされ得る |
| `getStaffPositionPresets` | `app/staff/page.tsx` → `useFetchData` が例外messageをtoastに含める |
| `getShifts`, `getShiftPatterns` | `useShiftData` は汎用toast。expected stateのcodeを判定できない |
| `getShiftSegments` | `ShiftFormModal` は汎用表示。認可失敗等を型付き結果へ移行する |
| `getOrgRolesFull` | `RoleManagementPanel` のreadは汎用表示、writeは例外messageをtoastへ表示 |
| `getSyncStatus`, `getGoogleConnectionHealth` | `useSyncProgress`, `app/settings/page.tsx` の認証・認可失敗を型付き結果へ移行する |
| `getLastBackupRun`, `listDailyBackups`, `getBackupRecords` | `app/backup/page.tsx` は主に汎用表示。認可失敗・不正パス等を区別できない |
| `getClientAssignmentPermissionHints` | `app/clients/[id]/page.tsx` の補助取得。認可失敗の戻り値契約を整理する |

write系では `clients.ts`, `staffs.ts`, `shifts/crud.ts` に `UserFacingError` が残る。
`roles.ts`, `staffRoles.ts`, `serviceTypes.ts` 等にも旧wrapperと例外message表示が残る。
read系から呼び出し元とともに段階的に移行し、完了後に旧message判定を撤去する。
認証・認可ヘルパーのexpected stateとDB failureを区別し、既存の認可/RLSは維持する。

## 検証

- `myShifts.test.ts`: 0件、記録の対応付け、未紐付け、各テーブルのDB failure、認証基盤例外。
- `shifts/my/page.test.tsx`: empty state、未紐付けと復旧フォーム、汎用表示と再試行、transport例外の秘匿、古い月のレスポンス排除。
- `record/page.test.tsx`: 未紐付けやtransport例外でも利用者一覧を表示する。
- `errors.test.ts`: 明示的なドメインエラーだけを公開し、安全そうな部分文字列を含む内部例外も秘匿する。
- `tests/my-shifts-errors.spec.ts`: 実際のActionを使って未紐付け→スタッフ登録→シフト0件を確認する。既存CIは `next build` + `next start` で実行する。

E2Eは現在の `scripts/e2e/run-local.mjs` により使い捨てのローカルSupabaseを使う。
今回の移植ではE2Eは未実施。テストをホスト済みDBに向けて実行しない。
