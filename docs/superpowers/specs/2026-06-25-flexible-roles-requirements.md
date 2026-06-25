# フレキシブル権限システム 要件定義書

**作成日:** 2026-06-25  
**対象システム:** care-record  
**ステータス:** 承認済み

---

## 1. 背景・目的

### 1.1 現状の課題

現在のシステムは `owner / manager / staff` の3ロール固定で権限を管理している。

| 課題 | 内容 |
|---|---|
| 柔軟性の欠如 | ロール名・数が固定で、組織ごとの職制を反映できない |
| 粒度の粗さ | 「管理者は全操作可能」「スタッフは担当のみ」の2択しかない |
| 1人1ロール制約 | 複数の役割を兼務するスタッフに対応できない |
| 管理系の一括制御 | 管理系機能はowner/managerの二択で個別設定不可 |

### 1.2 目的

- 組織ごとにロールを自由に作成・編集できるようにする
- 記録・シフトに対してリソース×アクション×スコープの細かい権限設定を可能にする
- 1人に複数ロールを付与でき、権限は許可優先でマージされる
- オーナーはロールとは独立した「組織所有権」の概念として維持する

---

## 2. 用語定義

| 用語 | 定義 |
|---|---|
| **オーナー (Owner)** | 組織の所有者。1組織につき1名のみ。ロールシステムとは独立し、組織レベルの特権操作（組織削除・オーナー移譲）を持つ |
| **メンバー (Member)** | オーナー以外の組織参加者。権限はロールによって決まる |
| **ロール (Role)** | 権限のセットに名前をつけたもの。組織ごとに作成・編集できる |
| **プリセットロール** | システムが提供するデフォルトロール（管理者・一般スタッフ）。削除・編集可能だが初期状態として提供される |
| **カスタムロール** | 組織が独自に作成したロール |
| **権限 (Permission)** | リソースに対するアクションの許可範囲。スコープを持つ |
| **スコープ (Scope)** | `all`（全体）/ `assigned`（担当クライアントのみ）/ `none`（不可）の3段階 |
| **実効権限 (Effective Permissions)** | メンバーに付与された全ロールをマージした最終的な権限セット |
| **担当クライアント** | `assignments` テーブルで `helper_id = user_id` となっているクライアント |

---

## 3. オーナーの仕様

### 3.1 特別性

オーナーはロールシステムの外側に存在する概念で、以下の特性を持つ。

| 項目 | 仕様 |
|---|---|
| 人数 | 1組織に1名のみ |
| 付与方法 | 組織作成時に自動付与 / `transfer_owner_atomic` RPC経由の移譲のみ |
| 剥奪 | オーナー移譲時に元オーナーはメンバーに降格する |

### 3.2 オーナー専権操作（ロール外）

以下の操作はオーナーのみ実行可能で、ロール設定に関わらず他メンバーは実行不可。

- 組織の削除
- オーナー移譲
- ロールの作成・編集・削除（カスタムロール管理）

### 3.3 オーナーの日常権限

オーナーは全リソース・全アクションに対して暗黙的に `all` スコープを持つ（ロール付与不要）。

---

## 4. ロールの仕様

### 4.1 プリセットロール

システムが組織作成時に自動生成する2つのロール。

#### 管理者（プリセット）

| リソース | アクション | スコープ |
|---|---|---|
| 記録 | 閲覧 | all |
| 記録 | 作成 | all |
| 記録 | 編集 | all |
| 記録 | 削除 | all |
| 記録 | 承認 | all |
| シフト | 閲覧 | all |
| シフト | 作成 | all |
| シフト | 編集 | all |
| シフト | 削除 | all |
| シフト | 承認 | all |
| 管理: スタッフ管理 | — | ON |
| 管理: クライアント管理 | — | ON |
| 管理: アカウント管理 | — | OFF |
| 管理: 組織設定 | — | OFF |
| 管理: 連携設定 | — | OFF |
| 管理: 監査ログ | — | ON |
| 管理: レポート閲覧 | — | ON |

#### 一般スタッフ（プリセット）

| リソース | アクション | スコープ |
|---|---|---|
| 記録 | 閲覧 | assigned |
| 記録 | 作成 | assigned |
| 記録 | 編集 | assigned |
| 記録 | 削除 | none |
| 記録 | 承認 | none |
| シフト | 閲覧 | assigned |
| シフト | 作成 | none |
| シフト | 編集 | none |
| シフト | 削除 | none |
| シフト | 承認 | none |
| 管理: 全項目 | — | OFF |

### 4.2 カスタムロール

- オーナーが任意の名前・カラーで作成可能
- 権限は後述のマトリクスから自由に設定
- 同一組織内でロール名はユニーク
- 削除時: そのロールを付与されているメンバーがいる場合は警告表示（削除は可能）

### 4.3 複数ロールの付与

- 1人のメンバーに複数ロールを同時付与可能
- 実効権限は全ロールの権限を **permit wins（許可優先）** でマージして算出

---

## 5. 権限の構造

### 5.1 権限マトリクス

#### 記録 (records)

| アクション | スコープ選択肢 | 説明 |
|---|---|---|
| 閲覧 (view) | all / assigned / none | ケア記録の参照 |
| 作成 (create) | all / assigned / none | 新規記録の作成 |
| 編集 (edit) | all / assigned / none | 既存記録の変更 |
| 削除 (delete) | all / none | 記録の論理削除（assignedスコープなし） |
| 承認 (approve) | all / none | 記録のステータスを承認/差し戻しに変更（assignedスコープなし） |

#### シフト (shifts)

| アクション | スコープ選択肢 | 説明 |
|---|---|---|
| 閲覧 (view) | all / assigned / none | シフトの参照 |
| 作成 (create) | all / assigned / none | シフトの新規作成 |
| 編集 (edit) | all / assigned / none | シフトの変更 |
| 削除 (delete) | all / none | シフトの削除 |
| 承認 (approve) | all / none | シフトの承認 |

#### 管理系 (management)

管理系はアクセスできる/できないの2択（スコープなし）。

| 管理機能 | キー | 説明 |
|---|---|---|
| スタッフ管理 | staffs | スタッフ一覧・プロフィール管理画面へのアクセス |
| クライアント管理 | clients | クライアント一覧・情報管理画面へのアクセス |
| アカウント管理 | accounts | メンバー招待・ロール付与・アカウント削除 |
| 組織設定 | organization | 組織名・基本設定変更 |
| 連携設定 | integrations | Google Calendar等の外部連携設定 |
| 監査ログ | auditLogs | 操作履歴の閲覧 |
| レポート閲覧 | reports | 統計・レポート画面へのアクセス |

> **注意:** `accounts` 権限があっても、ロールの作成・編集・削除はオーナー専権。アカウント管理権限があるメンバーは「招待の発行」「ロールの付与/変更」「メンバーの削除」のみ可能。

### 5.2 スコープの定義

| スコープ | 条件 |
|---|---|
| `all` | 組織内の全データにアクセス可能 |
| `assigned` | `assignments` テーブルで `helper_id = 自分のuser_id` となっているクライアントに紐づくデータのみ |
| `none` | アクセス不可 |

### 5.3 delete / approve にスコープが2択のみな理由

「自分が担当するクライアントの記録だけ削除できる」というユースケースは危険性が高く、誤操作リスクがある。承認も同様に、「担当のみ承認可能」は職制上の意味をなさない（承認は管理者的役割が行うべき）。これらは `all`（できる）か `none`（できない）の二択とする。

---

## 6. 実効権限のマージロジック

### 6.1 permit wins ルール

複数ロールが同一アクションに対して異なるスコープを持つ場合、最も広い権限が優先される。

```
スコープの優先順位: all > assigned > none
管理系の優先: true > false（いずれかのロールでONであればON）
```

### 6.2 例

```
ロールA: 記録.閲覧 = assigned
ロールB: 記録.閲覧 = all
→ 実効: 記録.閲覧 = all  ← allが優先

ロールA: 管理.reports = false
ロールB: 管理.reports = true
→ 実効: 管理.reports = true  ← trueが優先
```

### 6.3 明示的拒否（Deny）は存在しない

このシステムに明示的な拒否ルールはない。より広い権限が常に優先される。

---

## 7. データモデル

### 7.1 organization_roles テーブル（新規）

```sql
CREATE TABLE organization_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  color           text,                          -- UIカラー (#hex または named color)
  is_preset       boolean NOT NULL DEFAULT false,
  permissions     jsonb NOT NULL DEFAULT '{}',   -- RolePermissions 構造
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
```

### 7.2 organization_member_roles テーブル（新規）

```sql
CREATE TABLE organization_member_roles (
  organization_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  role_id         uuid NOT NULL REFERENCES organization_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, user_id, role_id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_members(organization_id, user_id) ON DELETE CASCADE
);
```

### 7.3 organization_members テーブル（変更）

| 変更前 | 変更後 |
|---|---|
| `role text CHECK(role IN ('owner','manager','staff'))` | `role text CHECK(role IN ('owner','member'))` |

- `'owner'`: 組織所有者
- `'member'`: それ以外の全メンバー（権限は organization_member_roles で管理）

### 7.4 invitations テーブル（変更）

| 変更前 | 変更後 |
|---|---|
| `role text NOT NULL` | `role_ids uuid[] NOT NULL DEFAULT '{}'` |

招待受諾時に付与するロールIDの配列。複数ロールを一度に付与可能。

### 7.5 permissions JSONB スキーマ

```typescript
type PermissionScope = 'all' | 'assigned' | 'none';

type RolePermissions = {
  records: {
    view:    PermissionScope;
    create:  PermissionScope;
    edit:    PermissionScope;
    delete:  'all' | 'none';
    approve: 'all' | 'none';
  };
  shifts: {
    view:    PermissionScope;
    create:  PermissionScope;
    edit:    PermissionScope;
    delete:  'all' | 'none';
    approve: 'all' | 'none';
  };
  management: {
    staffs:       boolean;
    clients:      boolean;
    accounts:     boolean;
    organization: boolean;
    integrations: boolean;
    auditLogs:    boolean;
    reports:      boolean;
  };
};
```

---

## 8. 機能要件

### 8.1 ロール管理（オーナー専権）

| ID | 機能 | 詳細 |
|---|---|---|
| R-01 | ロール一覧表示 | 組織のロール（プリセット+カスタム）を一覧表示 |
| R-02 | ロール作成 | 名前・カラー・権限マトリクスを指定して新規ロールを作成 |
| R-03 | ロール編集 | 既存ロール（プリセット含む）の名前・カラー・権限を変更 |
| R-04 | ロール削除 | ロールを削除。使用中メンバーへの影響を警告表示 |
| R-05 | プリセットリセット | プリセットロールをデフォルト権限に戻す |

### 8.2 メンバーへのロール付与

| ID | 機能 | 詳細 |
|---|---|---|
| M-01 | ロール付与 | メンバーに1つ以上のロールを付与（アカウント管理権限 or オーナー） |
| M-02 | ロール剥奪 | メンバーからロールを削除 |
| M-03 | 実効権限プレビュー | メンバーの現在の実効権限をマージ結果で表示 |

### 8.3 招待フロー

| ID | 機能 | 詳細 |
|---|---|---|
| I-01 | 招待作成 | 付与するロールIDの配列を指定して招待コードを発行 |
| I-02 | 招待受諾 | 招待コードを使用してメンバーに加入し、指定ロールを付与 |
| I-03 | 招待編集 | 未使用招待のロール設定を変更 |

### 8.4 権限チェック（Server Actions）

| ID | 機能 | 詳細 |
|---|---|---|
| P-01 | オーナー検証 | オーナー専権操作でオーナーであることを検証 |
| P-02 | 権限検証 | リソース・アクション・クライアントIDを受け取り実効権限を検証 |
| P-03 | 担当チェック | `assignments` テーブルからassignedスコープの可否を判定 |

### 8.5 データアクセス制御（RLS）

| ID | 機能 | 詳細 |
|---|---|---|
| D-01 | クライアントアクセス制御 | `can_access_client()` を新権限システムに対応させる |
| D-02 | 記録保存検証 | `save_report_atomic()` RPC の権限チェックを新システムに対応 |
| D-03 | 招待受諾の更新 | `accept_invitation_atomic()` RPC を role_ids 対応に更新 |

---

## 9. 非機能要件

### 9.1 セキュリティ

| 項目 | 要件 |
|---|---|
| サーバーサイド検証 | 全権限チェックはServer Action内またはDB関数内で実施。クライアントが渡すロール情報は信頼しない |
| 多層防御 | UI（表示制御）→ Server Action（権限検証）→ RLS（テナント境界）の3層 |
| 監査ログ | ロールの作成・編集・削除・付与・剥奪は全て `audit_events` テーブルに記録 |
| オーナー保護 | 最後のオーナーを削除・降格できない制約をサーバーサイドで維持 |

### 9.2 パフォーマンス

| 項目 | 要件 |
|---|---|
| RLSクエリ | `organization_member_roles(organization_id, user_id)` にインデックス必須 |
| 実効権限の計算 | ワークスペース読み込み時に1回取得し、context にキャッシュ |
| DB関数 | `get_effective_permission()` は SECURITY DEFINER + search_path 固定 |

### 9.3 後方互換性

| 項目 | 要件 |
|---|---|
| 既存メンバーの移行 | マイグレーション実行時に既存 manager → 管理者プリセット、staff → 一般スタッフプリセットへ自動移行 |
| 既存招待の扱い | 未使用招待は7日で期限切れになるため、移行期間中は古い `role` カラムから新 `role_ids` に変換する |

---

## 10. 画面一覧

### 10.1 新規ページ

| ページ | パス | アクセス権限 |
|---|---|---|
| ロール管理 | `/app/settings/roles` | オーナーのみ |

#### ロール管理ページの構成

```
[ロール一覧]
  - プリセットロール（バッジ表示）
  - カスタムロール
  - [新規ロール作成] ボタン（オーナーのみ）

[ロール作成・編集モーダル]
  - ロール名
  - カラーピッカー
  - 権限マトリクス:
    ┌─────────────┬──────┬──────┬──────┬──────┬──────┐
    │             │ 閲覧 │ 作成 │ 編集 │ 削除 │ 承認 │
    ├─────────────┼──────┼──────┼──────┼──────┼──────┤
    │ 記録        │ ○担×│ ○担×│ ○担×│ ○ × │ ○ × │
    │ シフト      │ ○担×│ ○担×│ ○担×│ ○ × │ ○ × │
    └─────────────┴──────┴──────┴──────┴──────┴──────┘
    ○=all 担=assigned ×=none

  - 管理系アクセス（チェックボックス一覧）:
    □ スタッフ管理  □ クライアント管理  □ アカウント管理
    □ 組織設定      □ 連携設定          □ 監査ログ  □ レポート
```

### 10.2 既存ページの変更

| ページ | 変更内容 |
|---|---|
| `/app/accounts` | ロール付与UIをドロップダウン → チェックボックスリストに変更。実効権限のプレビュー表示を追加 |
| ナビゲーション | 「設定」サブメニューに「ロール管理」を追加（オーナーのみ表示） |

---

## 11. APIインターフェース（Server Actions）

### ロール管理

```typescript
// ロール一覧取得（管理者権限以上）
getOrgRoles(orgId: string): Promise<OrgRole[]>

// ロール作成（オーナーのみ）
createOrgRole(orgId: string, name: string, color: string | null, permissions: RolePermissions): Promise<OrgRole>

// ロール更新（オーナーのみ）
updateOrgRole(orgId: string, roleId: string, patch: Partial<Pick<OrgRole, 'name' | 'color' | 'permissions'>>): Promise<void>

// ロール削除（オーナーのみ）
deleteOrgRole(orgId: string, roleId: string): Promise<void>
```

### メンバーロール管理

```typescript
// メンバーのロール付与・変更（オーナー or accounts権限）
updateMemberRoles(orgId: string, userId: string, roleIds: string[]): Promise<void>
```

### 招待

```typescript
// 招待作成（オーナー or accounts権限）
createInvitation(orgId: string, params: {
  targetName?: string;
  roleIds: string[];            // 旧: role: string
  targetClientIds?: string[];
}): Promise<{ code: string }>
```

---

## 12. 移行計画

### 12.1 マイグレーションSQL の実行順序

1. `organization_roles` テーブル作成
2. `organization_member_roles` テーブル作成
3. 既存組織ごとにプリセットロールをシード
4. 既存メンバー(manager/staff)を `organization_member_roles` に移行
5. `organization_members.role` を `'owner'|'member'` に変更
6. `invitations.role_ids` カラム追加・`role` カラム廃止
7. `private.get_effective_permission()` 関数追加
8. `private.can_access_client()` 更新
9. `save_report_atomic()` 更新
10. `accept_invitation_atomic()` 更新（role_ids 対応）
11. `transfer_owner_atomic()` 更新（降格先を 'member' に）
12. RLS ポリシー追加（新テーブル）
13. インデックス追加

### 12.2 ロールバック方針

マイグレーションは不可逆（既存データを変換するため）。本番適用前にステージング環境で十分に検証する。

---

## 13. 除外スコープ（今回対象外）

| 項目 | 理由 |
|---|---|
| チーム/グループ概念の導入 | スコープは「担当クライアント単位」で十分（合意済み） |
| 明示的拒否（Deny）ルール | 運用の複雑化を避ける（合意済み） |
| MFA・セッション管理 | 既存の仕組みを維持 |
| ロール階層（継承） | フラットな権限モデルで十分 |
| 時間帯・曜日による権限制限 | 現時点では不要 |

---

## 14. 検証方法

### 14.1 ユニットテスト

- `mergePermissions()`: permit wins のケース網羅（単一/複数/空ロール）
- `checkRecordPermission()`: スコープ×isAssigned の全組み合わせ
- `checkManagementPermission()`: 各管理エリアのON/OFF

### 14.2 統合テスト（E2Eシナリオ）

| シナリオ | 期待結果 |
|---|---|
| オーナーでカスタムロール「夜勤リーダー」を作成（記録.view=all, 記録.create=assigned） | ロール一覧に表示される |
| メンバーAに「夜勤リーダー」を付与してログイン | 全クライアントの記録を閲覧可能、担当クライアントのみ作成可能 |
| メンバーAが担当外クライアントの記録を作成しようとする | Server Actionで拒否される |
| Supabase Studio から直接 `SELECT * FROM reports` | RLSにより担当クライアント分のみ返る |
| 「管理者」+「夜勤リーダー」2つ付与したメンバーB | 広い方の権限(all)が実効権限になる |
| オーナー以外がロール削除を試みる | 403エラー |
| 最後のオーナーを削除しようとする | サーバーサイドで拒否 |
