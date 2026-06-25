# Task 1 Brief: Roboto font + theme.ts全面更新

## 作業ディレクトリ
/Users/shoug/Documents/GitHub/care-record/.claude/worktrees/ui-unification-m3

## 目的
Google風M3 UIへのフル刷新の基盤。フォントをRobotoに変え、MUIテーマのカラー・角丸・コンポーネントデフォルトをM3/Googleブルーに更新する。

## 変更ファイル

### 1. src/app/layout.tsx
- `next/font/google` から `Roboto` をインポート
- `subsets: ['latin']`、`weight: ['300','400','500','700']`
- `<body>` タグに `className={roboto.className}` を追加

### 2. src/theme.ts
以下の変更を適用：

#### designTokens変更点（exact values）
```ts
brand: {
  main:  '#1A73E8',   // #2255CC → #1A73E8
  light: '#4285F4',   // #6699FF → #4285F4
  dark:  '#1557B0',   // #003399 → #1557B0
},
surface: {
  canvas: '#F8F9FA',  // #F6F7F9 → #F8F9FA
  tint:   '#E8F0FE',  // #F0F5FF → #E8F0FE
  // paper / subtle / muted は変更なし
},
radius: {
  control: 8,   // 10 → 8
  card:    12,  // 変更なし
  dialog:  28,  // 16 → 28
  chip:    8,   // 新規追加
},
```

#### typography
```ts
fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
// 現在: 'Inter, "Helvetica Neue", Arial, sans-serif'
```

#### MUI コンポーネントオーバーライド
- `MuiDialog.paper`: `borderRadius: designTokens.radius.dialog`（28に自動反映）
- `MuiChip.root`: `borderRadius: designTokens.radius.chip`（= 8）に更新
- `MuiPaper.root`: `styleOverrides` に `boxShadow: 'none'` を追加（全ページでの手動指定を不要にする）
- `MuiCard.root`: `styleOverrides` に `boxShadow: 'none'` を追加
- `MuiTableContainer`（新規追加）: `defaultProps: {}`, `styleOverrides: { root: { boxShadow: 'none' } }`

## 制約
- PDFコンポーネント（src/components/pdf/）は変更しない
- `designTokens` の型定義は既存のまま維持（ただし `radius.chip` を追加する場合はas constで問題なし）
- `npm run build` が通ること

## 完了の定義
- `npm run build` がエラーなく完了
- コミット済み

## レポートファイル
完了後、作業内容を /Users/shoug/Documents/GitHub/care-record/.superpowers/sdd/task-1-report.md に書くこと
