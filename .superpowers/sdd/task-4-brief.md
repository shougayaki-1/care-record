# Task 4 Brief: 各ページ統一（13ページ）

## 作業ディレクトリ
/Users/shoug/Documents/GitHub/care-record/.claude/worktrees/ui-unification-m3

## 目的
全アプリページのUIパターンを統一する。3つの繰り返しパターンを適用する。

## 前提
`InnerPageHeader` は `src/components/ui/index.ts` からexportされている（Task 2で完了）。

## 適用パターン（3つ）

### パターンA：ページヘッダー置き換え
インラインの64pxヘッダーBoxを `InnerPageHeader` に置き換える。

```tsx
// Before
<Box sx={{ height: 64, borderBottom: 1, borderColor: 'divider', display: 'flex',
  alignItems: 'center', px: 3, flexShrink: 0, bgcolor: 'background.paper' }}>
  <SomeIcon sx={{ color: 'action.active', mr: 2 }} />
  <Typography variant="h6" fontWeight="bold" color="text.primary">タイトル</Typography>
</Box>

// After
<InnerPageHeader icon={<SomeIcon />} title="タイトル" />
```

actionsがある場合（タイトル右にボタン等がある場合）：
```tsx
<InnerPageHeader
  icon={<SomeIcon />}
  title="タイトル"
  actions={<><Button>...</Button></>}
/>
```

ToggleButtonGroup等がタイトル横にある場合はactionsに渡す。

### パターンB：Button → AppButton
生MUIの `Button` を `AppButton` に置き換える。

```tsx
// Before
import { Button } from '@/components/ui/mui';
<Button variant="contained" startIcon={<AddIcon />} onClick={...} sx={{ boxShadow: 'none' }}>
  追加
</Button>

// After  
import { AppButton } from '@/components/ui';
<AppButton startIcon={<AddIcon />} onClick={...}>追加</AppButton>
```

- `variant="contained"` → `AppButton` デフォルト（省略可）
- `variant="outlined"` → `<AppButton variant="outlined">`
- `variant="text"` → `<AppButton variant="text">`
- `color="error"` → `intent="danger"`
- `color="warning"` → `intent="warning"`
- `color="inherit"` / `color="default"` → `intent="secondary"` または `variant="text" intent="secondary"`
- `size="small"` はそのまま渡せる
- `sx={{ boxShadow: 'none' }}` は削除（テーマで設定済み）

**重要**: AppButtonはButtonのラッパーなので `startIcon`, `onClick`, `disabled` 等の通常propsはそのまま使える。

### パターンC：Paper/TableContainerの手動スタイル削除
```tsx
// Before
<Paper variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
// After
<Paper variant="outlined">

// Before  
<TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
// After
<TableContainer component={Paper} variant="outlined">
```

`borderRadius` と `boxShadow: 'none'` のハードコードを削除（テーマで処理済み）。
他のsxプロパティが残る場合はsxを維持しつつ該当プロパティのみ削除。

## 対象ファイルと各ファイルの状況

### 1. src/app/app/record/page.tsx
- ヘッダー: インラインBox（EditNoteIcon + "記録を作成"）→ パターンA
- Cardに `borderRadius: 3` がある場合→ パターンC
- `Button`使用なし（主にCardActionAreaとRouter）

### 2. src/app/app/history/page.tsx
- ヘッダー: インラインBox（HistoryIconまたは別アイコン + タイトル）→ パターンA
- `Button`があれば→ パターンB

### 3. src/app/app/profile/page.tsx
- ヘッダー: インラインBox → パターンA
- `Button`があれば→ パターンB
- `Paper borderRadius: 3, boxShadow: none` → パターンC

### 4. src/app/app/staff/page.tsx
- ヘッダー: インラインBox（BadgeIcon + "スタッフ(名簿)管理"）→ パターンA
- `Button variant="contained"` startIcon=AddIcon → パターンB
- `Button variant="outlined"` （退職者表示ボタン） → パターンB
- `TableContainer borderRadius: 3, boxShadow: 'none'` → パターンC
- Paperヘッダー部分の `border: 'none', bgcolor: 'transparent'` は維持（構造的なもの）

### 5. src/app/app/clients/page.tsx
- ヘッダー: インラインBox（PeopleIcon + タイトル）→ パターンA
- `Button`があれば→ パターンB

### 6. src/app/app/clients/[id]/page.tsx
- ヘッダーパターンを確認して適用

### 7. src/app/app/accounts/page.tsx
- ヘッダー: インラインBox → パターンA
- すでに一部AppButtonを使用しているが生Buttonも混在→ パターンB（残り）
- TableContainer→ パターンC

### 8. src/app/app/reports/page.tsx
- ヘッダー: インラインBox → パターンA
- `Button`があれば→ パターンB
- Paper/TableContainer → パターンC

### 9. src/app/app/statistics/page.tsx
- ヘッダー: インラインBox（Tabsが同じBoxに含まれる場合がある）→ パターンA（actionsにTabsを渡すか、ヘッダーBoxの後にTabsを別Boxで残す）
- `Button`があれば→ パターンB
- `Paper borderRadius: 3` → パターンC

### 10. src/app/app/shifts/manage/page.tsx
- ヘッダー: インラインBox → パターンA
- `Button`があれば→ パターンB

### 11. src/app/app/shifts/my/page.tsx
- ヘッダー: インラインBox（ToggleButtonGroupがタイトル横に）→ パターンA（ToggleButtonGroupをactionsへ）
- `Paper borderRadius: 2` → パターンC

### 12. src/app/app/settings/page.tsx
- ヘッダー: インラインBox（Tabsが同BoxまたはBox直後）→ パターンA
- 生MUI `Button`が多数 → パターンB（全て）
- Paper → パターンC

### 13. src/app/app/settings/roles/page.tsx
- ヘッダー: インラインBox → パターンA
- `Button`があれば→ パターンB

## import変更

各ファイルで:
- `InnerPageHeader` を `@/components/ui` から追加import
- `AppButton` を `@/components/ui` から追加import（既にある場合はスキップ）
- `Button` の import が不要になったら削除（ただし他の用途で使われていれば残す）
- `Typography` が InnerPageHeader で不要になった場合は削除してよいが、他で使っていれば残す

## 注意点

- ページ独自のsxプロパティ（padding、margin、flexDirection等）は変更しない
- 各ページのロジック（state、handlers、データ取得）は変更しない
- コンパイルエラーが出ないこと
- 全ページを変更し、1コミットにまとめる（または数コミットに分けてもよい）

## 制約
- PDFコンポーネントは変更しない
- `npm run build` が通ること

## 完了の定義
- 全13ページに3パターンを適用
- `npm run build` がエラーなく完了
- コミット済み（1つ以上）

## レポートファイル
/Users/shoug/Documents/GitHub/care-record/.superpowers/sdd/task-4-report.md
