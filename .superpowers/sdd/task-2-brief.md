# Task 2 Brief: InnerPageHeaderコンポーネント追加

## 作業ディレクトリ
/Users/shoug/Documents/GitHub/care-record/.claude/worktrees/ui-unification-m3

## 目的
全アプリページで重複している「64pxヘッダーボックス + アイコン + タイトル」パターンを共通コンポーネントに集約する。

## 変更ファイル

### 1. src/components/ui/Layout.tsx
既存の `PageContainer`、`PageHeader`、`SectionCard`、`EmptyState`、`StatusChip` に加えて、新しく `InnerPageHeader` コンポーネントを追加する。

```tsx
export function InnerPageHeader({
  icon,
  title,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Box
      sx={{
        height: 64,
        flexShrink: 0,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        px: 3,
        gap: 2,
      }}
    >
      {icon && (
        <Box sx={{ color: 'action.active', display: 'flex' }}>{icon}</Box>
      )}
      <Typography
        variant="h6"
        fontWeight="bold"
        color="text.primary"
        sx={{ flexGrow: 1 }}
      >
        {title}
      </Typography>
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}
```

### 2. src/components/ui/index.ts
`InnerPageHeader` を既存のexportに追加する。
現在の内容:
```ts
export * from './AppButton';
export * from './AppDialog';
export * from './DataTable';
export * from './DynamicFormField';
export * from './Fields';
export * from './Layout';
export * from './SelectionFields';
```
`Layout` は既に `export * from './Layout'` でre-exportされているため、`InnerPageHeader` を `Layout.tsx` に追加するだけで自動的にexportされる。追加作業不要。

## 制約
- このタスクではページファイルは変更しない（ページへの適用は後のTaskで行う）
- `Layout.tsx` の既存コンポーネントは変更しない
- TypeScriptコンパイルが通ること
- `npm run build` が通ること

## 完了の定義
- `InnerPageHeader` が `src/components/ui/Layout.tsx` に追加されている
- `src/components/ui/index.ts` から `InnerPageHeader` がexportされている（Layout経由で自動）
- `npm run build` がエラーなく完了
- コミット済み

## レポートファイル
完了後、作業内容を /Users/shoug/Documents/GitHub/care-record/.superpowers/sdd/task-2-report.md に書くこと
