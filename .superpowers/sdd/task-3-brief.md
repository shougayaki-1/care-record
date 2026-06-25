# Task 3 Brief: AppLayout折りたたみサイドバー

## 作業ディレクトリ
/Users/shoug/Documents/GitHub/care-record/.claude/worktrees/ui-unification-m3

## 目的
サイドバーに折りたたみ機能を追加する。展開時256px / 折りたたみ時72px（アイコンのみ）。状態はlocalStorageに永続化。

## 変更ファイル
`src/components/layout/AppLayout.tsx` のみ

## 実装仕様

### 1. AppLayoutコンポーネントへの変更

`AppLayout` に `sidebarOpen` state を追加：
```tsx
const [sidebarOpen, setSidebarOpen] = useState(() => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('sidebarOpen') !== 'false';
  }
  return true;
});

const toggleSidebar = () => {
  setSidebarOpen(prev => {
    const next = !prev;
    localStorage.setItem('sidebarOpen', String(next));
    return next;
  });
};
```

### 2. デスクトップサイドバーの幅

現在:
```tsx
<Box sx={{
  width: SIDEBAR_WIDTH,  // 256px固定
  flexShrink: 0,
  display: { xs: 'none', md: 'block' },
  borderRight: '1px solid',
  borderColor: 'divider',
  height: '100%'
}}>
```

変更後:
```tsx
<Box sx={{
  width: sidebarOpen ? 256 : 72,
  flexShrink: 0,
  display: { xs: 'none', md: 'block' },
  borderRight: '1px solid',
  borderColor: 'divider',
  height: '100%',
  transition: 'width 0.2s ease',
  overflow: 'hidden',
}}>
```

### 3. NavDrawerへのprops追加

`NavDrawer` コンポーネントの定義に `sidebarOpen: boolean` と `toggleSidebar: () => void` を追加：

```tsx
const NavDrawer = ({ currentOrg, onClose, sidebarOpen, toggleSidebar }: {
  currentOrg: Workspace | null;
  onClose?: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}) => { ... }
```

### 4. NavDrawer内部の変更

#### アイテムスタイル（itemStyle関数）
```tsx
const itemStyle = (active: boolean) => ({
  mx: sidebarOpen ? 1.5 : 0.5,
  my: 0.25,
  borderRadius: '24px',
  justifyContent: sidebarOpen ? 'flex-start' : 'center',
  minHeight: 48,
  color: active ? 'primary.main' : 'text.primary',
  bgcolor: active ? (t: Theme) => alpha(t.palette.primary.main, 0.12) : 'transparent',
  fontWeight: active ? 600 : 500,
  '&:hover': {
    bgcolor: active ? (t: Theme) => alpha(t.palette.primary.main, 0.16) : 'action.hover'
  },
  '& .MuiListItemIcon-root': {
    color: active ? 'primary.main' : 'text.secondary',
    minWidth: sidebarOpen ? 36 : 'unset',
    justifyContent: 'center',
  }
});
```

#### カテゴリラベル
折りたたみ時は非表示：
```tsx
{sidebarOpen && <Typography sx={categoryStyle}>記録</Typography>}
```
（全てのカテゴリラベルに同じ条件を適用）

#### ListItemText
折りたたみ時は非表示：
```tsx
{sidebarOpen && <ListItemText primary="記録を作成" primaryTypographyProps={{ fontSize: '0.95rem' }} />}
```
（全てのListItemTextに同じ条件を適用）

#### Tooltip（折りたたみ時のみ表示）
折りたたみ時はTooltipでナビアイテムのラベルを表示する。
ListItemButtonをTooltipでラップする：
```tsx
<Tooltip title={sidebarOpen ? '' : 'ナビラベル'} placement="right">
  <ListItemButton ...>
    ...
  </ListItemButton>
</Tooltip>
```

#### NavDrawer下部にトグルボタン追加
```tsx
<Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
  <IconButton onClick={toggleSidebar} sx={{ width: '100%', borderRadius: '24px' }}>
    {sidebarOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
  </IconButton>
</Box>
```

### 5. 折りたたみCollapseセクション
折りたたみ時は「提供記録一覧」のCollapseも常に閉じる（または非表示にする）：
```tsx
<Collapse in={sidebarOpen && openReports} timeout="auto" unmountOnExit>
```

### 6. AppLayoutからNavDrawerへのprops渡し
```tsx
<NavDrawer currentOrg={currentOrg} sidebarOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
// モバイルDrawer内のNavDrawerも同様
<NavDrawer currentOrg={currentOrg} onClose={() => setMobileOpen(false)} sidebarOpen={true} toggleSidebar={() => {}} />
```
※モバイルDrawerは常に展開（sidebarOpen=true固定）

### 7. 必要なimport追加
`ChevronLeftIcon` と `ChevronRightIcon` を追加：
```tsx
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
```

## 制約
- `SIDEBAR_WIDTH` 定数は削除して直接数値（256/72）を使うか、定数を2つに分けてよい
- モバイルDrawerの挙動は変更しない（開閉はハンバーガーメニューのまま）
- `npm run build` が通ること

## 完了の定義
- サイドバーがトグルボタンで256px↔72pxに切り替わる実装
- localStorage永続化
- `npm run build` がエラーなく完了
- コミット済み

## レポートファイル
/Users/shoug/Documents/GitHub/care-record/.superpowers/sdd/task-3-report.md
