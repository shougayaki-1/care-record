# ロールUI/UX改善 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ロール管理・割り当てUIを改善する — 色プリセット選択、Chip Toggle型ロール選択、統合権限ダイアログの3点を実装する

**Architecture:** 新規 `ColorPresetPicker` コンポーネントを作成し、既存の2ページ（settings/roles、accounts）を修正する。アクション層（roles.ts、accounts.ts）は変更不要。

**Tech Stack:** Next.js 14 App Router, MUI v5, TypeScript

## Global Constraints

- MUI コンポーネントは `@/components/ui/mui` 経由でインポートすること
- 新規コンポーネントは `src/components/roles/` に配置
- カラーコードは HEX 文字列で管理（DB の color カラム型と一致）
- TypeScript strict mode — `any` 型禁止
- コメントは原則書かない（コードが自明な場合）

---

## ファイルマップ

| ファイル | 種別 | 責務 |
|---------|------|------|
| `src/components/roles/ColorPresetPicker.tsx` | 新規 | 12色プリセットから色を選ぶ制御コンポーネント |
| `src/app/app/settings/roles/page.tsx` | 修正 | ColorPresetPicker を使用、色丸サイズ修正 |
| `src/app/app/accounts/page.tsx` | 修正 | 招待ダイアログChip Toggle化、統合権限ダイアログ |

---

## Task 1: ColorPresetPicker コンポーネント

**Files:**
- Create: `src/components/roles/ColorPresetPicker.tsx`

**Interfaces:**
- Produces: `default export ColorPresetPicker({ value: string, onChange: (color: string) => void }): JSX.Element`

- [ ] **Step 1: ファイルを作成する**

`src/components/roles/ColorPresetPicker.tsx` を以下の内容で作成する:

```tsx
'use client';

import { Box, Tooltip } from '@/components/ui/mui';
import CheckIcon from '@mui/icons-material/Check';

const PRESET_COLORS = [
  { label: 'レッド',     value: '#EF4444' },
  { label: 'オレンジ',   value: '#F97316' },
  { label: 'アンバー',   value: '#F59E0B' },
  { label: 'イエロー',   value: '#EAB308' },
  { label: 'ライム',     value: '#84CC16' },
  { label: 'グリーン',   value: '#22C55E' },
  { label: 'ティール',   value: '#14B8A6' },
  { label: 'シアン',     value: '#06B6D4' },
  { label: 'ブルー',     value: '#3B82F6' },
  { label: 'インディゴ', value: '#6366F1' },
  { label: 'パープル',   value: '#8B5CF6' },
  { label: 'ピンク',     value: '#EC4899' },
] as const;

type Props = {
  value: string;
  onChange: (color: string) => void;
};

export default function ColorPresetPicker({ value, onChange }: Props) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {PRESET_COLORS.map((color) => (
        <Tooltip key={color.value} title={color.label} placement="top">
          <Box
            onClick={() => onChange(color.value)}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: color.value,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: value === color.value
                ? `3px solid ${color.value}`
                : '3px solid transparent',
              outlineOffset: 2,
              transition: 'outline 0.1s',
              '&:hover': { opacity: 0.85 },
            }}
          >
            {value === color.value && (
              <CheckIcon sx={{ fontSize: 16, color: '#fff' }} />
            )}
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: ビルドエラーがないか確認する**

```bash
cd /Users/shoug/Documents/GitHub/care-record
npx tsc --noEmit 2>&1 | head -30
```

期待値: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/roles/ColorPresetPicker.tsx
git commit -m "feat: add ColorPresetPicker with 12-color preset palette"
```

---

## Task 2: ロール管理ページ修正

**Files:**
- Modify: `src/app/app/settings/roles/page.tsx`

**Interfaces:**
- Consumes: `ColorPresetPicker({ value: string, onChange: (color: string) => void })` from Task 1

**変更内容:**
1. `ColorPresetPicker` をインポートし `<input type="color">` を置き換える
2. ロール一覧の色丸サイズを 12→16 に拡大

- [ ] **Step 1: ColorPresetPicker をインポートする**

`src/app/app/settings/roles/page.tsx` の既存インポートの末尾に追加:

```tsx
import ColorPresetPicker from '@/components/roles/ColorPresetPicker';
```

- [ ] **Step 2: ダイアログ内の色選択UIを置き換える**

`src/app/app/settings/roles/page.tsx` の以下の箇所（176〜193行付近）を:

```tsx
          <Stack direction="row" spacing={2} alignItems="flex-end">
            <TextField
              label="ロール名"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              required
              fullWidth
              size="small"
            />
            <Box>
              <Typography variant="caption" display="block">カラー</Typography>
              <input
                type="color"
                value={formColor}
                onChange={e => setFormColor(e.target.value)}
                style={{ display: 'block', width: 48, height: 36, cursor: 'pointer', border: 'none' }}
              />
            </Box>
          </Stack>
```

以下に置き換える:

```tsx
          <TextField
            label="ロール名"
            value={formName}
            onChange={e => setFormName(e.target.value)}
            required
            fullWidth
            size="small"
          />
          <Box>
            <Typography variant="caption" display="block" mb={0.5}>カラー</Typography>
            <ColorPresetPicker value={formColor} onChange={setFormColor} />
          </Box>
```

- [ ] **Step 3: ロール一覧の色丸サイズを修正する**

`src/app/app/settings/roles/page.tsx` の以下の行（142行付近）を:

```tsx
              <Box width={12} height={12} borderRadius="50%" bgcolor={role.color ?? 'grey.400'} flexShrink={0} />
```

以下に置き換える:

```tsx
              <Box width={16} height={16} borderRadius="50%" bgcolor={role.color ?? 'grey.400'} flexShrink={0} />
```

- [ ] **Step 4: ビルドエラーがないか確認する**

```bash
npx tsc --noEmit 2>&1 | head -30
```

期待値: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/app/settings/roles/page.tsx
git commit -m "feat: replace color picker with preset palette in roles page"
```

---

## Task 3: アカウント管理ページ修正

**Files:**
- Modify: `src/app/app/accounts/page.tsx`

**変更内容:**
1. 招待ダイアログのチェックボックス → Chip Toggle
2. 権限変更ダイアログを統合ダイアログに拡張（ロール割り当て追加）
3. 「一般(ヘルパー)」→「一般」

- [ ] **Step 1: 不要なインポートを削除し、必要なものを確認する**

`accounts/page.tsx` の MUI インポートブロック（4〜9行）を以下に置き換える（`Checkbox, FormControlLabel, FormGroup` を削除、`Divider` を追加）:

```tsx
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, Button, TextField, Stack,
  IconButton, Select, MenuItem, FormControl, InputLabel, Menu, Alert, ListItemIcon,
  CircularProgress, Divider,
} from '@/components/ui/mui';
```

- [ ] **Step 2: ロール割り当て用の state を追加する**

`accounts/page.tsx` の既存 state 宣言ブロック（`openRoleDialog` 付近、57〜58行）の直下に追記:

```tsx
  const [editOrgRoleIds, setEditOrgRoleIds] = useState<string[]>([]);
```

- [ ] **Step 3: openRoleEditDialog でロールの初期値もセットする**

`accounts/page.tsx` の `openRoleEditDialog` 関数（135〜140行）を以下に置き換える:

```tsx
  const openRoleEditDialog = () => {
    if (!selectedAccount) return;
    setEditRole(selectedAccount.role);
    setEditOrgRoleIds(selectedAccount.roles?.map(r => r.id) ?? []);
    setOpenRoleDialog(true);
    handleMenuClose();
  };
```

- [ ] **Step 4: executeRoleChange でロールも保存する**

`accounts/page.tsx` の `executeRoleChange` 関数（142〜171行）を以下に置き換える:

```tsx
  const executeRoleChange = async () => {
    if (!currentOrg || !selectedAccount) return;
    try {
      if (selectedAccount.id === currentUserId && selectedAccount.role === 'owner' && editRole !== 'owner') {
        const ownerCount = accountList.filter(a => a.role === 'owner' && a.status === 'active').length;
        if (ownerCount <= 1) {
          showToast('あなたは最後のオーナーです。他の人にオーナー権限を付与してから変更してください。', 'error');
          setOpenRoleDialog(false);
          return;
        }
      }

      await updateAccountRole(currentOrg.id, {
        targetId: selectedAccount.id,
        status: selectedAccount.status === 'active' ? 'active' : 'invited',
        newRole: editRole,
      });

      if (selectedAccount.status === 'active' && editRole !== 'owner') {
        await updateMemberRoles(currentOrg.id, selectedAccount.id, editOrgRoleIds);
      }

      showToast('権限を変更しました');
      setOpenRoleDialog(false);
      fetchData();

      if (selectedAccount.id === currentUserId && editRole !== 'owner') {
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (error) {
      console.error(error);
      showToast('変更に失敗しました', 'error');
    }
  };
```

- [ ] **Step 5: 権限変更ダイアログを統合ダイアログに更新する**

`accounts/page.tsx` の権限変更ダイアログ（349〜370行付近）全体を以下に置き換える:

```tsx
      {/* --- 権限・ロール変更ダイアログ --- */}
      <AppDialog open={openRoleDialog} onClose={() => setOpenRoleDialog(false)} maxWidth="xs" title="権限・ロールの変更" dividers={false} actions={<><AppButton variant="text" intent="secondary" onClick={() => setOpenRoleDialog(false)}>キャンセル</AppButton><AppButton onClick={executeRoleChange}>変更を保存</AppButton></>}>
        <Box pt={1}>
          <Typography variant="body2" mb={2}>
            <b>{selectedAccount?.name}</b> さんの権限を変更します。
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel>システム権限</InputLabel>
            <Select value={editRole} onChange={(e) => setEditRole(e.target.value)} label="システム権限">
              <MenuItem value="staff">一般 - 記録の作成のみ</MenuItem>
              <MenuItem value="manager">管理者 - シフト管理・利用者管理</MenuItem>
              {selectedAccount?.status === 'active' && (
                <MenuItem value="owner">オーナー - 全ての権限・事業所設定</MenuItem>
              )}
            </Select>
          </FormControl>
          {selectedAccount?.id === currentUserId && editRole !== 'owner' && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              自分の権限を降格させると、再度オーナーに戻ることはできません。
            </Alert>
          )}
          {availableRoles.length > 0 && editRole !== 'owner' && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" mb={1}>割り当てるロール</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {availableRoles.map((role) => {
                  const selected = editOrgRoleIds.includes(role.id);
                  return (
                    <Chip
                      key={role.id}
                      label={role.name}
                      onClick={() => {
                        if (selected) setEditOrgRoleIds(prev => prev.filter(id => id !== role.id));
                        else setEditOrgRoleIds(prev => [...prev, role.id]);
                      }}
                      variant={selected ? 'filled' : 'outlined'}
                      sx={{
                        cursor: 'pointer',
                        borderColor: role.color ?? undefined,
                        color: selected ? '#fff' : (role.color ?? undefined),
                        bgcolor: selected ? (role.color ?? undefined) : undefined,
                      }}
                    />
                  );
                })}
              </Box>
            </>
          )}
        </Box>
      </AppDialog>
```

- [ ] **Step 6: 招待ダイアログのロール選択を Chip Toggle に変更する**

`accounts/page.tsx` の招待ダイアログ内のロール選択部分（377〜395行付近）:

```tsx
                    {availableRoles.length > 0 && (
                        <Box width="100%">
                          <Typography variant="subtitle2" mb={1}>付与するロール</Typography>
                          {availableRoles.map(role => (
                            <Box key={role.id} display="flex" alignItems="center">
                              <Checkbox
                                size="small"
                                checked={selectedRoleIds.includes(role.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedRoleIds(prev => [...prev, role.id]);
                                  else setSelectedRoleIds(prev => prev.filter(id => id !== role.id));
                                }}
                              />
                              <Box width={10} height={10} borderRadius="50%" bgcolor={role.color ?? 'grey.400'} mr={0.5} />
                              <Typography variant="body2">{role.name}</Typography>
                            </Box>
                          ))}
                        </Box>
                    )}
```

を以下に置き換える:

```tsx
                    {availableRoles.length > 0 && (
                        <Box width="100%">
                          <Typography variant="subtitle2" mb={1}>付与するロール</Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {availableRoles.map((role) => {
                              const selected = selectedRoleIds.includes(role.id);
                              return (
                                <Chip
                                  key={role.id}
                                  label={role.name}
                                  onClick={() => {
                                    if (selected) setSelectedRoleIds(prev => prev.filter(id => id !== role.id));
                                    else setSelectedRoleIds(prev => [...prev, role.id]);
                                  }}
                                  variant={selected ? 'filled' : 'outlined'}
                                  sx={{
                                    cursor: 'pointer',
                                    borderColor: role.color ?? undefined,
                                    color: selected ? '#fff' : (role.color ?? undefined),
                                    bgcolor: selected ? (role.color ?? undefined) : undefined,
                                  }}
                                />
                              );
                            })}
                          </Box>
                        </Box>
                    )}
```

- [ ] **Step 7: 「一般(ヘルパー)」ラベルを修正する**

`accounts/page.tsx` の 285行付近:

```tsx
                                        <Chip
                                            label="一般(ヘルパー)"
                                            size="small"
                                            color="default"
                                            variant="outlined"
                                        />
```

を以下に置き換える:

```tsx
                                        <Chip
                                            label="一般"
                                            size="small"
                                            color="default"
                                            variant="outlined"
                                        />
```

- [ ] **Step 8: ビルドエラーがないか確認する**

```bash
npx tsc --noEmit 2>&1 | head -30
```

期待値: エラーなし

- [ ] **Step 9: コミット**

```bash
git add src/app/app/accounts/page.tsx
git commit -m "feat: chip toggle role selection and unified permission dialog in accounts page"
```

---

## 完了チェック

- [ ] `ColorPresetPicker` で12色が表示され、選択色にチェックマークが出る
- [ ] ロール管理ページの作成/編集ダイアログでカラーピッカーがプリセット選択に変わっている
- [ ] ロール一覧の色丸が以前より少し大きい
- [ ] 招待ダイアログのロール選択が Chip Toggle になっている（複数選択可能）
- [ ] 「権限を変更」ダイアログのタイトルが「権限・ロールの変更」になっている
- [ ] 権限変更ダイアログでロールの Chip Toggle が表示され、既存ロールが初期選択されている
- [ ] システム権限が「オーナー」の時はロールセクションが非表示
- [ ] アカウント一覧で「一般(ヘルパー)」が「一般」になっている
