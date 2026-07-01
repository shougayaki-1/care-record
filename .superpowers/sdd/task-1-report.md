# Task 1 Report: permission_alignment.sql 検証

## Checklist Results

- ✅ **`private.has_management_permission` が owner と role JSONB の `management.*` 両方をカバーする**
  - `om.role = 'owner'` の EXISTS チェックと、`r.permissions -> 'management' ->> p_area = 'true'` の EXISTS チェックが OR で結合されている。正しい。

- ✅ **`private.can_access_client` が `records.view = 'all'` のユーザーと assignment ユーザー双方をカバーする**
  - `s.record_scope = 'all'` の OR 分岐と、`s.record_scope = 'assigned' AND is_assigned_client_for_user(...)` の OR 分岐が共存している。正しい。

- ✅ **`private.get_member_internal_work_scope` が `'all'` / `'assigned'` / `'none'` を正しく返す**
  - owner → `'all'`、JSONB の `internalWork -> p_action = 'all'` → `'all'`、`= 'assigned'` → `'assigned'`、それ以外 → `'none'`（COALESCE で NULL も `'none'`）。正しい。

- ✅ **`Internal work visible by flexible role` ポリシーが古い `Internal work visible to org members` を DROP する**
  - 行 116: `DROP POLICY IF EXISTS "Internal work visible to org members"` が存在する。正しい。

- ✅ **shifts 系ポリシーが `get_member_shift_action_scope` を使用する**
  - `shifts`、`shift_patterns`、`shift_staffs`、`shift_pattern_staffs` の全ポリシーが `private.get_member_shift_action_scope(...)` を使用している。正しい。

- ✅ **clients / staffs / assignments / form_templates / organization_members / invitations / organizations の各ポリシーが `has_management_permission` を使用する**
  - 全テーブルのポリシーが `private.has_management_permission(...)` または `private.can_manage_any_org_settings(...)` (内部で `has_management_permission` を使用) を経由している。正しい。

- ⚠️ **GRANT 文が `private.*` 関数に `authenticated` ロールへの EXECUTE を付与している**
  - `has_management_permission`、`can_manage_any_org_settings`、`get_member_internal_work_scope` の 3 関数には GRANT がある。
  - **しかし `private.can_access_client` への GRANT が欠落している。**
  - `can_access_client` は SECURITY DEFINER 関数のため、RLS ポリシー内から直接呼ぶ場合には不要な場合もあるが、init.sql では同様の関数に GRANT が付与されており、一貫性と将来的な直接呼び出しリスクを考えると追加が望ましい。

- ✅ **Step 1.2: `is_org_admin` が owner-only に戻っていることを確認**
  - 行 24〜35 の定義がブリーフ記載の期待値と完全一致。`om.role = 'owner'` のみをチェックする。正しい。

- ✅ **Step 1.3: `can_access_client` が `management.reports` もカバーすることを確認**
  - 行 74: `private.has_management_permission(s.organization_id, auth.uid(), 'reports')` が OR 分岐に含まれている。正しい。

## Summary

マイグレーションの内容はほぼ正しく、ブリーフのチェック項目を概ね満たしている。**適用可能だが、1 件の軽微な懸念がある。**

`private.can_access_client` への `GRANT EXECUTE TO authenticated` が欠落している。現状は SECURITY DEFINER 関数かつ RLS ポリシー内での呼び出しのみであるため実害は生じにくいが、他の private 関数との一貫性が損なわれる。

## Issues Found

### ⚠️ `private.can_access_client` への GRANT 欠落（軽微）

**場所:** ファイル末尾 (行 273〜275)

**問題:** `can_access_client` 関数が新たに定義されているが、対応する GRANT 文がない。
init.sql では他の private 関数（`get_actor_staff_id`、`get_member_record_view_scope` 等）すべてに GRANT が付与されている。

**修正案（適用前に追記推奨）:**
```sql
GRANT EXECUTE ON FUNCTION "private"."can_access_client"("uuid") TO "authenticated";
```

**重大度:** 低。RLS ポリシー内の SECURITY DEFINER 関数として呼ばれる限り動作するが、一貫性のため追加すべき。
