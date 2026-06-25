# 「立場」と「業務ロール」の命名・UI整理

**日付:** 2026-06-25  
**状態:** 承認済み

---

## 背景・課題

現在、アカウント管理UIに「システム権限」という列があり、以下の2つの異なる概念が1カラムに混在している。

- `organization_members.role`（`owner` / `member`）: 組織における **立場**。オーナーは全権限・組織設定を持つ固定の立場。
- `organization_roles` テーブル: **業務ロール**。メンバーに複数割り当て可能な職務権限定義。マージされて有効権限を構成する。

この混在がユーザーに「ロールとシステム権限の違いは何か」という混乱を生んでいた。

---

## 解決方針

**立場（Membership Level）** と **業務ロール（Job Role）** を、命名・UI両面で明確に分離する。

---

## 変更詳細

### 1. アカウントページ テーブル（`src/app/app/accounts/page.tsx`）

**Before:** `アカウント情報` / `システム権限` / `状態` / `操作`（4列）

**After:** `アカウント情報` / `立場` / `業務ロール` / `状態` / `操作`（5列）

- **「立場」列**（width: 120）
  - `owner`: 「オーナー」chip（color=primary, variant=filled）
  - `member`: 「メンバー」chip（color=default, variant=outlined）
- **「業務ロール」列**（width: 200）
  - オーナー: `—`（ダッシュ）
  - メンバー・ロールあり: カラー付き outlined chip を並べる（既存と同じ表示）
  - メンバー・ロールなし: 「未設定」chip（color=default, variant=outlined）

### 2. 権限変更ダイアログ（`src/app/app/accounts/page.tsx`）

**タイトル:** `権限・ロールの変更` → `立場と業務ロールの変更`

**構成:**

```
セクション1: 組織での立場
  Select:
    - オーナー — 全権限・組織設定を含むすべての操作が可能
    - メンバー — 以下の業務ロールで権限を個別に設定
  ※ オーナー降格時の警告は維持

セクション2: 業務ロール（立場が「メンバー」の場合のみ表示）
  見出し: 「業務ロール」
  チップ群でトグル選択（既存UIを維持）
```

**Select の値マッピング:**  
UIの選択値 `'owner'` / `'member'` をそのまま `updateAccountRole` の `newRole` に渡す。  
現行の `'staff'` / `'manager'` 選択肢は廃止し、`'owner'` / `'member'` に統一する。

> **注:** 現行コードでは Select の値として `staff` / `manager` / `owner` が使われているが、サーバー側 `VALID_ROLES = ['owner', 'member']` と不一致のため、`staff`・`manager` は事実上無効な値になっていた。今回の変更でこの不整合も解消する。

### 3. ロール管理ページ（`src/app/app/settings/roles/page.tsx`）

- **ページタイトル:** `ロール管理` → `業務ロール管理`
- **ページ上部に説明文を追加:**  
  「業務ロールはメンバーの職務権限を定義します。オーナーの立場とは独立した設定です。」

### 4. 型・変数名（コード）

| ファイル | Before | After |
|---|---|---|
| `src/utils/supabase/auth.ts` | `export type OrgRole = 'owner' \| 'member'` | `export type MembershipLevel = 'owner' \| 'member'` |
| `src/context/WorkspaceContext.tsx` | `export type OrganizationRole = 'owner' \| 'member'` | `export type MembershipLevel = 'owner' \| 'member'` |
| `src/context/WorkspaceContext.tsx` | `Workspace.role: OrganizationRole` | `Workspace.membershipLevel: MembershipLevel` |

`MembershipLevel` を参照している箇所（`assertOrgRole` の戻り値、`currentOrg.role` の参照箇所など）は一括リネーム。

---

## スコープ外

- データベーススキーマの変更なし（`organization_members.role` カラム名はそのまま）
- RLSポリシーの変更なし
- `organization_roles` のデータ構造変更なし
- 招待フローの大幅な変更なし（招待ダイアログの「付与するロール」表記は「業務ロール」に統一するのみ）

---

## 影響ファイル一覧

### UIメインの変更
1. `src/app/app/accounts/page.tsx` — テーブル列分割・ダイアログ改修
2. `src/app/app/settings/roles/page.tsx` — タイトル・説明文変更
3. `src/app/app/profile/page.tsx` — `currentOrg.role` の生値表示を日本語ラベルに変更

### 型・命名の変更（一括リネーム）
4. `src/utils/supabase/auth.ts` — `OrgRole` → `MembershipLevel` リネーム
5. `src/context/WorkspaceContext.tsx` — `OrganizationRole` → `MembershipLevel`、`Workspace.role` → `Workspace.membershipLevel`
6. `src/app/actions/workspace.ts` — `OrgRole` import → `MembershipLevel`
7. `currentOrg.role` を参照している全ファイル（`membershipLevel` にリネーム）:
   - `src/app/app/settings/roles/page.tsx`
   - `src/app/app/settings/page.tsx`
   - `src/components/layout/AppLayout.tsx`
   - その他参照箇所

### デッドコードの除去（ついでに修正）
8. `['owner', 'manager'].includes(currentOrg.role)` → `currentOrg.membershipLevel === 'owner'` に修正
   - `src/app/app/record/page.tsx`
   - `src/app/app/record/[clientId]/page.tsx`
   - `src/app/app/shifts/manage/page.tsx`
   - `src/hooks/useShiftData.ts`
   
   > 理由: `currentOrg.role` の型は `'owner' | 'member'` であり `'manager'` は存在しないため、`'manager'` のチェックは永遠にマッチしないデッドコードだった。
