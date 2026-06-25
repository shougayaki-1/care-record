# ロールUI/UX改善 設計ドキュメント

**日付:** 2026-06-25  
**対象:** `src/app/app/settings/roles/page.tsx`, `src/app/app/accounts/page.tsx`

---

## 背景・目的

現状のロール管理・割り当てUIに以下の問題がある。

1. ロールの色が自由入力カラーピッカーで、統一感がない
2. 既存メンバーへのロール（組織ロール）割り当て変更UIがない
3. 招待ダイアログのロール選択UIが視覚的にわかりにくい
4. その他、細かいUX問題が複数存在する

---

## セクション1: `ColorPresetPicker` コンポーネント

### ファイル
`src/components/roles/ColorPresetPicker.tsx`（新規作成）

### 仕様
- 12色のプリセットを横並びの丸ボタンで表示
- 選択中の色は白チェックマークオーバーレイで示す
- `value: string` / `onChange: (color: string) => void` の制御コンポーネント
- `<input type="color">` の代替として `settings/roles/page.tsx` で使用

### プリセット12色

| 色名 | HEX |
|------|-----|
| レッド | `#EF4444` |
| オレンジ | `#F97316` |
| アンバー | `#F59E0B` |
| イエロー | `#EAB308` |
| ライム | `#84CC16` |
| グリーン | `#22C55E` |
| ティール | `#14B8A6` |
| シアン | `#06B6D4` |
| ブルー | `#3B82F6` |
| インディゴ | `#6366F1` |
| パープル | `#8B5CF6` |
| ピンク | `#EC4899` |

---

## セクション2: Chip Toggle 型ロール選択 UI

### 使用箇所
- 招待ダイアログ（既存のチェックボックスUIを置き換え）
- 権限・ロール変更ダイアログ（新規追加セクション）

### 仕様
- ロールごとに1つのChipを横並び（flexWrap）で表示
- **未選択:** `variant="outlined"` + ロールの色で枠線・テキスト
- **選択中:** `variant="filled"` + ロールの色で背景・白テキスト
- クリックでトグル、複数選択可能
- ロールが0件の場合はセクション自体を非表示

---

## セクション3: 統合「権限・ロール変更」ダイアログ

### 対象ファイル
`src/app/app/accounts/page.tsx`

### 変更内容
- タイトル: `権限の変更` → `権限・ロールの変更`
- **セクション1（既存）:** システム権限 Select（staff / manager / owner）
- **セクション2（新規）:** 「割り当てるロール」Chip Toggle（セクション2のUI）
  - ダイアログ開時に `selectedAccount.roles` の id を初期選択状態にする
  - システム権限が `owner` の場合はロールセクションを非表示（オーナーはロール不要）
- **保存時:** `updateAccountRole` と `updateMemberRoles` を両方呼ぶ
  - オーナーの場合は `updateAccountRole` のみ
- ダイアログ内のステートとして `editOrgRoleIds: string[]` を追加

---

## セクション4: その他UX修正

| 場所 | 現状 | 修正内容 |
|------|------|---------|
| `settings/roles/page.tsx` ロール一覧 | 色丸 `width:12, height:12` | `width:16, height:16` に拡大 |
| `accounts/page.tsx` アカウント一覧 | ロールなし時「一般(ヘルパー)」 | 「一般」に変更 |
| 招待ダイアログ | Checkbox + 小さい丸の素朴なリスト | セクション2のChip Toggleに統一 |

---

## 影響範囲

- **新規ファイル:** `src/components/roles/ColorPresetPicker.tsx`
- **変更ファイル:**
  - `src/app/app/settings/roles/page.tsx`
  - `src/app/app/accounts/page.tsx`
- **変更なし:** `src/app/actions/roles.ts`, `src/app/actions/accounts.ts`（既存の `updateMemberRoles` をそのまま使用）

---

## データフロー

```
ColorPresetPicker
  → formColor (string) → createOrgRole / updateOrgRole

Chip Toggle (招待)
  → selectedRoleIds (string[]) → createInvitation

Chip Toggle (権限変更)
  → editOrgRoleIds (string[]) → updateMemberRoles
システム権限 Select
  → editRole (string) → updateAccountRole
```
