# 提供記録エクスポート仕様

## 目的

本仕様は、実地指導や障害時に提供記録表をすばやく検索・提示するための退避データ形式を定義します。画像は対象外とし、提供記録の一覧・詳細・可変フォーム値のみを対象にします。

## 出力方針

- 1日1回以上の定期エクスポートを行う
- 事業所単位で出力する
- 検索用の固定列と、原本保全用の可変値を分ける
- ファイルは暗号化済みのオブジェクトストレージへ保存する
- 検索時は復元済みDBを待たず、この退避データを直接参照する

## 固定列

以下の列を最低限含めます。

- `organization_id`
- `report_id`
- `client_id`
- `client_name`
- `status`
- `start_at`
- `end_at`
- `approved_at`
- `approved_by`
- `shift_id`
- `helper_names`
- `service_time`
- `travel_time`
- `deleted_at`
- `deleted_by`
- `deletion_reason`
- `retention_until`
- `created_at`
- `updated_at`

## 可変値

- `report_values`
  - 既存フォームの `data` をそのまま保存する
  - `_helpers`, `service_time`, `travel_time` を含める
  - テンプレート変更後も復元可能なよう、原文を保持する

## 索引

検索性を上げるため、以下の索引を同梱します。

- `exported_at`
- `organization_id`
- `client_name`
- `report_date`
- `status`
- `has_deleted`

## 配布と利用

- 通常運用ではエクスポート済みファイルを検索して提示する
- 監査・復旧時は同一データを復旧用保全に使う
- 保持期間は記録種別ごとの方針に従う
