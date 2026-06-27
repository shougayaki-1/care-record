# Task 3 実装レポート: 組織削除にowner必須チェックを追加

## 実装概要

組織削除に `organizationDelete` 権限に加えて、owner ロール要件を追加した。

## 実施した変更

### 1. src/app/actions/organization.ts
deleteOrganization 関数：
- `assertOrgPermission` の返り値から `isOwner` を取得
- `isOwner` が false の場合にエラーを throw
- コメントを更新：「owner かつ organizationDelete 権限が必要」

変更行数：3行（コメント更新 + 変数追加 + 条件判定追加）

### 2. src/app/app/settings/page.tsx
canDeleteOrganization の判定ロジック：
- 既存：`checkManagementPermission(currentOrg.effectivePermissions, 'organizationDelete')`
- 変更後：`currentOrg.role === 'owner' && checkManagementPermission(...)`

変更行数：1行

## 検証

```bash
npx tsc --noEmit
```

TypeScript 型チェック：パス ✓

## コミット

`6035afe` feat: require owner for organization deletion

## 備考

- 2重DB アクセスを避けるため、既存の assertOrgPermission の戻り値を活用
- currentOrg.role は WorkspaceContext の Workspace 型に存在する OrganizationRole フィールド
