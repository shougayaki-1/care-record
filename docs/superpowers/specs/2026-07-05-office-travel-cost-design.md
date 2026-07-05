# 事業所マスタと交通費設定の移行 設計

## 背景・目的

交通費計算まわりの改善要望：

- 「事業所」を追加できるようにする（利用者・スタッフの所属先タグ）
- 交通費単価の設定を組織全体から事業所ごとに移す
- 提供記録での距離表示・イレギュラー時の変更

調査の結果、距離マスタ（`assignments.round_trip_distance_km`）と提供記録での距離表示・上書き
（提供記録の`data`内`round_trip_distance_km`/`travel_cost_yen`）は既に実装済みと判明。
本設計は「事業所」マスタの新設と、交通費単価の参照先を組織単位から事業所単位に移すことに絞る。

## スコープ外

- 事業所ごとのRLSスコープ分離（事業所は所属タグであり、権限境界ではない）
- 住所からの距離自動計算（距離は引き続き利用者×スタッフのペアで手動登録）
- `organizations.travel_cost_rate_yen_per_km` カラムの削除（破壊的なため残置、参照のみ廃止）

## データモデル

### 新規テーブル `offices`

- `id uuid PK default gen_random_uuid()`
- `organization_id uuid NOT NULL references organizations(id)`
- `name text NOT NULL`
- `travel_cost_rate_yen_per_km numeric(8,2) NOT NULL DEFAULT 20`
  （CHECK: 0以上10000以下、`organizations.travel_cost_rate_yen_per_km` と同じ制約）
- `archived_at timestamp with time zone`（論理削除。物理DELETEは行わない）
- `created_at`, `updated_at`

### 既存テーブルの変更

- `clients.office_id uuid references offices(id) ON DELETE RESTRICT`（nullable）
- `staffs.office_id uuid references offices(id) ON DELETE RESTRICT`（nullable）

`ON DELETE RESTRICT` により、client/staffが割り当てられている事業所は削除（アーカイブ済みレコードの
物理的な参照整合性という意味でのDB制約）できない。アプリ側の「アーカイブ」操作はUPDATEのみなので
実際にRESTRICTが働くのは想定外の物理DELETEに対する保険。

### バックフィル（新規マイグレーション内で実施）

各`organizations`行について：

1. `offices` に1件、`name = organizations.name`（またはデフォルト名）、
   `travel_cost_rate_yen_per_km = organizations.travel_cost_rate_yen_per_km` で作成
2. その組織に属する全 `clients` / `staffs` の `office_id` を作成した事業所IDで埋める

これにより既存データは移行後も「事業所未設定」状態にならない。

### 交通費単価の参照ルール

- 提供記録作成時の交通費計算は「**担当スタッフが所属する事業所**」の単価を使う
  （利用者の事業所ではなく、スタッフの事業所を優先。理由: 交通費はスタッフの移動コストという性質のため）
- スタッフに `office_id` が未設定の場合はエラーとする（フォールバックなし。事業所未割当のスタッフは
  設定画面で対応してもらう運用とする）

## RLS / 権限

- `offices` に対する SELECT は `is_org_member()` による組織スコープ（既存の他マスタテーブルと同様）
- 書き込み（作成・更新・アーカイブ）は既存の交通費単価編集を許可している権限エリアを流用し、
  Server Action側で `assertOrgPermission(orgId, ...)` によりチェックする
  （`permissions.ts` 側の対応するエリア定義との整合を実装時に確認し、変更内容に明記する）

## Server Actions

新規 `src/app/actions/offices.ts`（`staffRoles.ts` と同じ構造）:

- `getOffices(organizationId)` — `assertOrgRole` で読取チェック、アーカイブ済みを除外して一覧
- `createOffice(organizationId, name, rate)` — `assertOrgPermission` チェック、`sanitizeDbError`、`recordAuditEvent`
- `updateOffice(officeId, name, rate)` — 同上
- `archiveOffice(officeId)` — 同上。`clients`/`staffs` に割当がある場合はアプリ側でも警告を出す

既存Actionの変更：

- `src/app/actions/clients.ts` の作成・更新処理に `office_id` 保存を追加
- `src/app/actions/staffs.ts` の作成・更新処理に `office_id` 保存を追加
- 提供記録作成時の交通費計算箇所（`src/app/app/record/[clientId]/page.tsx`）で、
  組織の単価ではなく、担当スタッフの `office_id` から `offices.travel_cost_rate_yen_per_km` を引く
  マップに変更する

## UI

- `src/app/app/settings/` の現行「交通費設定」セクションを事業所一覧の管理パネルに置き換える
  - 一覧表示、追加・編集（名称＋単価/km）、アーカイブ
  - `RoleManagementPanel.tsx` と同様のテーブル＋ダイアログ構成をベースに、
    `src/components/ui` のセマンティックコンポーネントを優先して使う（新規UIのため）
- クライアント編集画面・スタッフ編集画面（`clients/[id]/page.tsx`, `staff/page.tsx`）に
  「所属事業所」の `SelectField` を追加

## 提供記録（変更なし部分の確認）

距離の表示・イレギュラー時の値変更は既存の仕組み（`round_trip_distance_km`, `travel_cost_yen` を
提供記録データに保持し、デフォルト値を上書き可能）をそのまま使う。変更されるのはデフォルト値算出時の
単価の参照元のみ。

## テスト方針

- `offices.ts` の Server Action に対する unit test（`npm run test:unit`）
- `permissions.ts` / RLS 変更に伴い `supabase/tests/security_hardening.test.sql` の更新要否を確認
- 新規UIコンポーネントに対応する Storybook ストーリー
- `npm run typecheck` / `npm run lint` を変更後に実行
