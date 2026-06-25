# 設計書：勤務時間管理拡充 & 提供記録×シフト紐付け強化

**作成日：** 2026-06-25  
**ステータス：** レビュー待ち

---

## 概要

本書は以下2機能の要件・設計を定義する。

1. **Feature A — 労働時間管理拡充**：深夜・時間外などの割り増し種別を組織ごとに設定し、職員別の対象時間内訳を統計ページで確認できるようにする。
2. **Feature B — 提供記録×シフト紐付け強化**：1つの提供記録に複数シフトを紐付けられるようにし、複数担当者問題を解消する。あわせて統計ページにシフト別予実差異一覧を追加する。

---

## Feature A：労働時間管理拡充

### A-1. 要件

| # | 要件 |
|---|------|
| A-1-1 | 組織ごとに割り増し種別を設定できる（1組織＝1セット） |
| A-1-2 | 標準種別として「深夜割り増し」「時間外割り増し」を持つ |
| A-1-3 | 種別は後から追加・変更・無効化できる |
| A-1-4 | 各種別に割り増し率（%）を設定できる |
| A-1-5 | 各種別ごとに計算方式（加算 or 乗算）を設定できる |
| A-1-6 | 深夜の時間帯境界（開始・終了時刻）を設定できる |
| A-1-7 | 時間外の閾値（日次・週次の上限時間）を設定できる |
| A-1-8 | 統計ページで職員別の種別ごと該当時間数を表示する |
| A-1-9 | 金額換算は将来対応（現時点では時間数のみ） |

### A-2. データモデル

#### `labor_premium_types`（新規テーブル）

```sql
create table labor_premium_types (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,

  -- 表示・管理
  name             text not null,                         -- 例: "深夜割り増し"
  display_order    int  not null default 0,
  is_enabled       boolean not null default true,

  -- 計算パラメータ
  rate             numeric(5,4) not null,                 -- 例: 0.25 = 25%
  calc_method      text not null check (calc_method in ('additive', 'multiplicative')),
  -- additive   : ベース × (1 + Σrate_n)  ← 各種別の rate を合算してから掛ける
  -- multiplicative : ベース × Π(1 + rate_n) ← 各種別を順に掛け合わせる
  -- 両方混在する場合は additive を先にまとめ、multiplicative を後から順次適用する

  -- 組み込み種別の識別
  builtin_type     text check (builtin_type in ('night', 'overtime', 'custom')),
  -- 'night'    : 時間帯で判定（night_start_hour / night_end_hour を使用）
  -- 'overtime' : 日次・週次の閾値超過で判定（overtime_*_threshold を使用）
  -- 'custom'   : 時間帯指定のみ（将来拡張用。night と同じ判定ロジックを共有）

  -- 深夜・カスタム種別用（時間帯指定）
  night_start_hour smallint check (night_start_hour between 0 and 23),  -- 例: 22
  night_end_hour   smallint check (night_end_hour   between 0 and 23),  -- 例: 5
  -- ※ start > end の場合は日をまたぐ（22:00〜翌5:00）として扱う

  -- 時間外種別用
  overtime_daily_threshold_hours   numeric(4,2),   -- 例: 8.0
  overtime_weekly_threshold_hours  numeric(4,2),   -- 例: 40.0

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- インデックス
create index on labor_premium_types (organization_id, display_order);
```

#### 初期データ（組織作成時に自動投入）

| name | builtin_type | rate | calc_method | night_start | night_end | daily_threshold | weekly_threshold |
|------|-------------|------|-------------|-------------|-----------|-----------------|-----------------|
| 深夜割り増し | night | 0.25 | additive | 22 | 5 | — | — |
| 時間外割り増し | overtime | 0.25 | multiplicative | — | — | 8.0 | 40.0 |

### A-3. 計算ロジック

#### A-3-1. 時間区間の分解

1シフト（または実績）の時間帯を**分単位**で走査し、各分が「どの種別に該当するか」を判定する。

```
判定順:
1. 深夜（night）: 分の属する時刻が [night_start_hour, night_end_hour) に含まれるか
   - start > end の場合（日またぎ）: 時刻 >= start OR 時刻 < end
2. 時間外（overtime）:
   - 日次: その日の累積勤務時間が overtime_daily_threshold_hours を超過した分
   - 週次: その週の累積勤務時間が overtime_weekly_threshold_hours を超過した分
   - どちらか一方でも超過すれば対象
```

#### A-3-2. 複数種別が重なった場合の計算式

```
1. 該当する種別を additive グループと multiplicative グループに分ける
2. additive_sum  = Σ(additive 種別の rate)
3. multiplier    = Π(1 + rate)   for each multiplicative 種別
4. 最終係数      = (1 + additive_sum) × multiplier
```

**例**: 深夜25%（加算）＋時間外25%（乗算）が同時に適用された場合  
`(1 + 0.25) × (1 + 0.25) = 1.25 × 1.25 = 1.5625`

#### A-3-3. 集計の単位

- 統計ページでの表示は「月単位」（既存と同じ）
- 職員1名につき、月間の種別ごと対象時間数を合計して表示
- 週次判定は月内の各週（月曜〜日曜）を単位とする

### A-4. 設定UI

**場所：** `設定` ページ内に「労働時間ルール」セクションを追加

**表示内容：**
- 割り増し種別一覧（並び替え可能、有効/無効切替可）
- 種別ごとに編集モーダル：
  - 名称
  - 割り増し率（%）
  - 計算方式（加算 / 乗算）
  - 種別タイプ（深夜 / 時間外 / カスタム）
  - 深夜：開始時刻・終了時刻
  - 時間外：日次閾値（h）・週次閾値（h）
- 「種別を追加」ボタン
- 削除は「無効化」で対応（履歴のあるデータは物理削除しない）

### A-5. 統計ページの変更

#### 既存テーブル（職員タブ）に列を追加

| 職員名 | 予定時間 | 実績時間 | 差異 | 深夜h | 時間外h | … |
|--------|---------|---------|------|-------|--------|---|

- 追加列は有効な割り増し種別の数だけ動的に生成
- 種別列には実績時間に対する該当時間数を表示（予定時間への適用は将来）
- CSVエクスポートにも種別列を追加

---

## Feature B：提供記録×シフト紐付け強化

### B-1. 要件

| # | 要件 |
|---|------|
| B-1-1 | 1つの提供記録に複数のシフトを紐付けられる（多対多） |
| B-1-2 | 紐付けには「主シフト」と「副シフト」の区別がある |
| B-1-3 | 主シフトから記録を起票したとき、同利用者・時間帯重複のシフトをサジェストする |
| B-1-4 | 記録作成後も、シフトの追加・変更・解除ができる |
| B-1-5 | サジェストはすでに紐付き済みのシフトを除外する |
| B-1-6 | 利用者1名につき1記録が原則（同一シフトに複数記録を作らない） |
| B-1-7 | 統計ページに「シフト別予実差異一覧」タブ/セクションを追加する |
| B-1-8 | 記録が紐付いていないシフト（実績なし）も一覧に表示する |

### B-2. データモデル

#### `report_shifts`（新規テーブル：中間テーブル）

```sql
create table report_shifts (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references reports(id) on delete cascade,
  shift_id    uuid not null references shifts(id) on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),

  unique (report_id, shift_id)
);

create index on report_shifts (report_id);
create index on report_shifts (shift_id);
```

#### `reports`テーブルの既存 `shift_id` カラムの扱い

- **移行方針：後方互換を保ちつつ `report_shifts` を正とする**
- 既存の `reports.shift_id` は残す（削除しない）
- 既存データはマイグレーションで `report_shifts` へコピー（`is_primary = true`）
- 新規作成時は `reports.shift_id` にも同時書き込み（主シフトのIDを設定）
- 将来フェーズで `reports.shift_id` を廃止予定（本設計書の対象外）

### B-3. 記録起票フロー（シフトカレンダーから）

```
1. シフトカレンダーでシフトをクリック
2. 「記録を作成/開く」→ ?shiftId=xxx で record/[clientId] へ遷移
3. 記録ページが開く：
   a. 既存記録なし → 新規モードで主シフトの時間・担当者を初期値に設定
   b. 既存記録あり → その記録を開く（重複防止：既存コードのまま）
4. ページ読み込み時に「追加シフトのサジェスト」を表示
   - 対象：同client_id かつ start_at/end_at が主シフトと重複するシフト
   - 除外：すでに report_shifts に存在するシフト、自分自身（主シフト）
   - 表示：「○○さん（10:00〜12:00）のシフトを紐付けますか？」形式のバナーorチップ
5. ユーザーがサジェストを承認 → report_shifts に副シフトを追加
6. 後から「シフト紐付けを管理」ボタンで追加・解除も可能
```

### B-4. シフトサジェストの詳細仕様

#### 重複判定

```
primary_shift の start_at を S、end_at を E とする。
候補シフト candidate が以下を満たすとき「時間帯重複」と判定:
  candidate.start_at < E  AND  candidate.end_at > S
  （端点が一致するだけでは重複しない）
```

#### サジェスト表示条件

- 候補シフトの `status != 'cancelled'`
- 候補シフトがまだ他の記録に主シフトとして紐付いていない  
  （別記録の副シフトにはなっていてもOK）
- 記録の `status` が `draft` または `remanded` のとき表示

#### サジェストUI

- 記録フォーム上部に黄色バナー（InfoAlert相当）で表示
- 「〇〇様の訪問に △△さん（10:00〜12:00）が参加しています。紐付けますか？」
- [紐付ける] [無視する] の2択
- 複数候補がある場合は件数分バナーを並べる

### B-5. シフト紐付け管理UI（記録フォーム内）

- 「担当シフト」セクションを記録フォームに追加
- 紐付き済みシフトをチップ形式で表示（例: 「山田太郎 9:00〜15:00 [主] ×」「鈴木花子 10:00〜12:00 ×」）
- [+ シフトを追加] で検索モーダル → 同client_id のシフトをカレンダー日付で絞り込み
- × ボタンで紐付け解除（主シフトは解除できない。変更は「主シフトを変更」ボタンで別途対応）

### B-6. 統計ページ：シフト別予実差異一覧

#### 表示場所

既存の「職員タブ」「利用者タブ」に加え「シフト差異タブ」を追加

#### テーブル定義

| 列名 | 内容 |
|------|------|
| シフト日時 | start_at の日付・時刻（ソート可） |
| 利用者名 | shifts.clients.name |
| 担当職員 | shift_staffs から取得（複数名の場合はカンマ区切り） |
| 予定時間 | shifts の (end_at - start_at) を時間換算 |
| 実績時間 | 紐付き記録の (end_at - start_at)。紐付きなしは「—」 |
| 差異 | 実績 - 予定（マイナスは赤表示） |
| 記録 | 紐付き記録へのリンク（紐付きなしは「記録なし」ラベル） |

#### フィルタ

- 対象月（既存と同じ月選択UI）
- 「記録なし（実績未入力）のみ表示」チェックボックス
- 職員フィルタ（shift_staffs で絞り込み）

#### データ取得方針

```
1. shifts を月でフィルタして取得（status != 'cancelled'）
2. report_shifts で左結合して対応する report を取得
3. 記録なしのシフトも一覧に表示（LEFT JOIN）
4. 複数記録が紐付く場合：実績時間は紐付き記録の合計（通常は1件）
```

---

## 実装フェーズ案

| フェーズ | 内容 | 前提 |
|---------|------|------|
| Phase 1 | `labor_premium_types` テーブル作成＋設定UI | なし |
| Phase 2 | 割り増し計算ロジック実装＋統計ページ種別列追加 | Phase 1 |
| Phase 3 | `report_shifts` テーブル作成＋既存データ移行 | なし |
| Phase 4 | 記録フォームにサジェスト＋シフト管理UI追加 | Phase 3 |
| Phase 5 | 統計ページにシフト差異タブ追加 | Phase 3 |

Phase 1〜2 と Phase 3〜5 は並行開発可能。

---

## 未解決事項・将来検討

| 項目 | 内容 |
|------|------|
| 金額換算 | 時給マスタ追加後に `labor_premium_types.rate` から賃金計算（Feature A 将来対応） |
| `reports.shift_id` 廃止 | Phase 3〜4 が安定したタイミングで移行・廃止 |
| 副シフトの記録への影響 | 副シフトの担当者を記録の `_helpers` に自動追加するか（要検討） |
| 主シフト変更フロー | 主シフトを差し替える場合のUX（現時点では未設計） |
| 週次集計の境界 | 月をまたぐ週の時間外計算をどう扱うか（月内の日次のみで近似するか） |
