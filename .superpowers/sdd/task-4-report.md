# Task 4 Report: UI Pattern Unification (12 Pages)

## 完了日時
2026-06-25

## 結果
DONE — `npm run build` エラーなし

## 変更ファイル一覧

| ファイル | パターンA | パターンB | パターンC |
|---|---|---|---|
| `src/app/app/record/page.tsx` | ✅ InnerPageHeader | — | ✅ Card borderRadius 削除 |
| `src/app/app/history/page.tsx` | ✅ InnerPageHeader + Tabs は actions に | — | ✅ Card borderRadius 削除 |
| `src/app/app/profile/page.tsx` | ✅ InnerPageHeader | ✅ 4箇所 Button → AppButton | ✅ Paper borderRadius 削除（3箇所） |
| `src/app/app/staff/page.tsx` | ✅ InnerPageHeader | ✅ 2箇所 Button → AppButton | ✅ TableContainer borderRadius/boxShadow 削除 |
| `src/app/app/clients/page.tsx` | ─ 既にPageHeader使用、変更不要 | — | — |
| `src/app/app/clients/[id]/page.tsx` | ─ カスタム detail ページ（back button + Tabs）、構造維持 | ✅ 5箇所 Button → AppButton | — |
| `src/app/app/accounts/page.tsx` | ✅ InnerPageHeader | ✅ 3箇所 Button → AppButton | ✅ TableContainer borderRadius/boxShadow 削除 |
| `src/app/app/reports/page.tsx` | ✅ InnerPageHeader | ✅ 8箇所 Button → AppButton | — |
| `src/app/app/statistics/page.tsx` | ✅ InnerPageHeader + Tabs は別Box | ✅ 2箇所 Button → AppButton | ✅ Paper borderRadius/boxShadow 削除 |
| `src/app/app/shifts/manage/page.tsx` | ✅ InnerPageHeader + Tabs は別Box + 条件付き actions | ✅ 7箇所 Button → AppButton | ✅ Paper/TableContainer borderRadius 削除 |
| `src/app/app/shifts/my/page.tsx` | ✅ InnerPageHeader + ToggleButtonGroup を actions に + 月ナビ別Box | — | ✅ Paper borderRadius 削除 |
| `src/app/app/settings/page.tsx` | ✅ InnerPageHeader + Tabs は別Box | ✅ 9箇所 Button → AppButton | ✅ Paper borderRadius 削除（5箇所） |
| `src/app/app/settings/roles/page.tsx` | ✅ InnerPageHeader（Box構造を再編） | ✅ 4箇所 Button → AppButton | — |

## 判断事項

- **clients/page.tsx**: 既に `PageHeader` コンポーネントを使用しており、インラインBox形式ではなかったため変更不要
- **clients/[id]/page.tsx**: detail ページ（back button + client name + Tabs の複合ヘッダー）のため InnerPageHeader は適用せず。Button のみ AppButton に置換
- **history ページの Tabs**: ナビゲーション用タブのため `actions` prop に渡した
- **statistics/shifts/manage/settings ページの Tabs**: ナビゲーション用タブのため `InnerPageHeader` の直後に別 `<Box sx={{ borderBottom: 1, borderColor: 'divider' }}>` でTabsを表示
- **shifts/my ページの月ナビ**: リスト表示時のみ表示するため別 Box として残した
- **settings ページの "フォルダを開く" ボタン**: `target="_blank"` が AppButtonProps に型定義されていないため raw `Button` を維持
- **AppButton の color マッピング**: `color="error"` → `intent="danger"`, `color="warning"` → `intent="warning"`, `color="secondary"` → `intent="secondary"`, `color="success"` → `intent="secondary"` または `intent` 省略（green系はテーマ依存）

## ビルド結果
`npm run build` 成功、TypeScript エラーなし
