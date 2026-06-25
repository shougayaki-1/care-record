# Care Record バックアップ実装ガイド（IT担当者向け）

作成日: 2026-06-25

## 概要

本ドキュメントは、Care Record の提供記録データを Google Cloud Storage (GCS) で安全に保管するための実装ガイドです。本番停止時の迅速なデータ提示と長期保全を両立する二層構成を採用します。

## 推奨システム構成

### ストレージ構成

| データセット | 用途 | 保存場所 | ストレージクラス | 保存期間 | 特徴 |
|---|---|---|---|---|---|
| 日次検索用エクスポート | 実地指導、障害時の即時提示 | GCS 東京 | Standard | 90日 | 取得料金なし。ミリ秒単位でアクセス |
| 月次確定エクスポート | 長期保全、監査、事故対応 | GCS 東京 | Archive | 7年 | 低コスト。ミリ秒単位で読み出し可能 |
| 復旧用設定情報 | 障害復旧時の環境構築 | GCS 東京 | Standard | 1年 | 環境変数、Migration、運用手順 |

### ライフサイクル管理

Standard から Archive への自動移行を設定：

```
Standard ストレージ（90日）→ Archive ストレージ（7年保管）
```

ライフサイクルルール：
- **Delete アクション** — 7年経過後に自動削除
- **SetStorageClass アクション** — 90日経過後に Archive へ自動移行

### Bucket Lock（改ざん防止）

Archive バケットに対して Bucket Lock を設定し、保存期間中の削除・短縮を防止します。

```
Retention Period: 2555 日（7年）
Locked: true
```

## エクスポート形式と内容

### CSV フォーマット

推奨形式。外部ツールでの処理が容易。

```
利用者名,記録日,サービス開始日時,サービス終了日時,担当者,提供時間,移動時間,承認状態,削除状態,記録内容,加算,備考,テンプレート項目...
```

### JSON フォーマット

構造化データが必要な場合。スキーマ版管理、バージョン追跡に向く。

```json
{
  "export_date": "2026-06-25T00:00:00Z",
  "records": [
    {
      "record_id": "rec_xxx",
      "client_name": "...",
      "record_date": "2026-06-25",
      "service_start": "2026-06-25T10:00:00Z",
      "service_end": "2026-06-25T11:00:00Z",
      "staff_id": "staff_xxx",
      "service_hours": 1.0,
      "travel_hours": 0.25,
      "approval_status": "approved",
      "is_deleted": false,
      "record_content": "...",
      "addons": [...],
      "notes": "...",
      "template_fields": {...}
    }
  ],
  "record_count": 123,
  "schema_version": "1.0"
}
```

**推奨：CSV で実装し、必要に応じて JSON を追加**

## 実装手順

### Phase 1: GCS セットアップ（1-2週）

#### 1. GCP プロジェクト作成

```bash
gcloud projects create care-record-backup --name="Care Record Backup"
gcloud config set project care-record-backup
```

#### 2. GCS バケット作成

Standard バケット（検索用）：

```bash
gsutil mb -p care-record-backup \
  -l asia-northeast1 \
  -b on \
  gs://care-record-search-daily
```

Archive バケット（保全用）：

```bash
gsutil mb -p care-record-backup \
  -l asia-northeast1 \
  -b on \
  gs://care-record-archive-7y
```

#### 3. ライフサイクルポリシー設定

Standard バケットに JSON ポリシーを適用：

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "SetStorageClass", "storageClass": "ARCHIVE"},
        "condition": {"age": 90}
      },
      {
        "action": {"type": "Delete"},
        "condition": {"age": 2555}
      }
    ]
  }
}
```

```bash
gsutil lifecycle set lifecycle.json gs://care-record-search-daily
```

#### 4. Bucket Lock 設定（Archive バケット）

```bash
gsutil retention set 2555d gs://care-record-archive-7y
```

確認：

```bash
gsutil retention get gs://care-record-archive-7y
```

#### 5. サービスアカウント作成と認証

```bash
gcloud iam service-accounts create care-record-backup \
  --display-name="Care Record Backup Service"

gcloud projects add-iam-policy-binding care-record-backup \
  --member="serviceAccount:care-record-backup@care-record-backup.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"

gcloud projects add-iam-policy-binding care-record-backup \
  --member="serviceAccount:care-record-backup@care-record-backup.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

### Phase 2: Care Record 側の実装（2-3週）

#### 1. エクスポート機能の実装

`src/app/actions/backup.ts` に追加：

```typescript
export async function exportRecordsForBackup(
  organizationId: string,
  format: 'csv' | 'json' = 'csv'
): Promise<string> {
  const supabase = createServiceRoleClient();
  
  const { data: records, error } = await supabase
    .from('records')
    .select(`
      id,
      client_id,
      clients(name),
      record_date,
      service_start,
      service_end,
      staff_id,
      staff(name),
      service_hours,
      travel_hours,
      approval_status,
      is_deleted,
      record_content,
      addons,
      notes
    `)
    .eq('organization_id', organizationId)
    .eq('is_deleted', false)
    .gte('record_date', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
    .order('record_date', { ascending: false });

  if (error) throw new Error(`Export failed: ${error.message}`);

  if (format === 'json') {
    return JSON.stringify({
      export_date: new Date().toISOString(),
      records,
      record_count: records.length,
      schema_version: '1.0'
    }, null, 2);
  }

  // CSV フォーマット
  const csv = [
    ['利用者名', '記録日', '開始時刻', '終了時刻', '担当者', '提供時間', '移動時間', '内容'].join(','),
    ...records.map(r => [
      r.clients.name,
      r.record_date,
      r.service_start,
      r.service_end,
      r.staff.name,
      r.service_hours,
      r.travel_hours,
      r.record_content
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  return csv;
}
```

#### 2. GCS へのアップロード実装

`src/utils/gcs/upload.ts` に追加：

```typescript
import { Storage } from '@google-cloud/storage';

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GCP_SERVICE_ACCOUNT_KEY_PATH
});

export async function uploadToGCS(
  bucketName: string,
  fileName: string,
  content: string
): Promise<void> {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(fileName);

  await file.save(content, {
    metadata: {
      contentType: fileName.endsWith('.json') ? 'application/json' : 'text/csv',
      cacheControl: 'no-cache'
    }
  });

  console.log(`Uploaded ${fileName} to gs://${bucketName}/${fileName}`);
}
```

#### 3. 日次バッチ処理（Vercel Crons）

`vercel.json` に追加：

```json
{
  "crons": [
    {
      "path": "/api/backup/daily",
      "schedule": "0 1 * * *"
    }
  ]
}
```

`src/app/api/backup/daily/route.ts` を実装：

```typescript
import { exportRecordsForBackup } from '@/app/actions/backup';
import { uploadToGCS } from '@/utils/gcs/upload';

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  
  if (secret !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const organizations = await getActiveOrganizations();

    for (const org of organizations) {
      const csv = await exportRecordsForBackup(org.id, 'csv');
      const fileName = `daily/${org.id}/${new Date().toISOString().split('T')[0]}.csv`;
      
      await uploadToGCS('care-record-search-daily', fileName, csv);
    }

    return new Response('Daily backup completed', { status: 200 });
  } catch (error) {
    console.error('Daily backup failed:', error);
    return new Response('Backup failed', { status: 500 });
  }
}
```

#### 4. 月次確定版の生成と Archive へのアップロード

月初に実行するバッチ：

```typescript
export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const organizations = await getActiveOrganizations();
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    for (const org of organizations) {
      const json = await exportRecordsForBackup(org.id, 'json');
      const fileName = `monthly/${org.id}/${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}.json`;
      
      await uploadToGCS('care-record-archive-7y', fileName, json);
    }

    return new Response('Monthly backup completed', { status: 200 });
  } catch (error) {
    console.error('Monthly backup failed:', error);
    return new Response('Backup failed', { status: 500 });
  }
}
```

### Phase 3: 復旧テスト手順の確立（1週）

#### テスト計画

毎月初週に実施：

1. **Standard バケットからの取得テスト**
   ```bash
   gsutil cp gs://care-record-search-daily/daily/{org_id}/{date}.csv ./test_daily.csv
   # 取得時間を記録（目標：<1秒）
   ```

2. **Archive バケットからの取得テスト**
   ```bash
   gsutil cp gs://care-record-archive-7y/monthly/{org_id}/{year}-{month}.json ./test_archive.json
   # 取得時間を記録（目標：<10秒）
   ```

3. **データ整合性チェック**
   ```bash
   # ファイルサイズ、レコード数、ハッシュ値を検証
   wc -l test_daily.csv
   md5sum test_daily.csv
   ```

4. **復旧シミュレーション**
   - CSV を Care Record の import 機能でロード
   - 日付範囲、レコード数の照合

#### テスト記録テンプレート

```
日付: 2026-06-25
Standard 取得時間: 0.8秒
Archive 取得時間: 3.2秒
レコード数: 1,234
整合性: ✓ OK
実施者: [IT担当者名]
```

## 環境変数とシークレット管理

`.env.example` に追加：

```
# Google Cloud
GCP_PROJECT_ID=care-record-backup
GCP_SERVICE_ACCOUNT_KEY_PATH=/etc/secrets/gcs-service-account.json

# Backup
CRON_SECRET=[32文字のランダム値]
BACKUP_ORGANIZATION_IDS=org_xxx,org_yyy
```

**Production 環境：**
- GCP_SERVICE_ACCOUNT_KEY_PATH は Vercel Secrets として管理
- CRON_SECRET は Vercel Environment Variables で管理

## 料金見積もり

### ストレージ料金（月額）

毎月新規に生成されるデータ量別。Standard には直近 90日分、Archive には 7年分が蓄積。

| 月間新規データ | Standard（90日回転） | Archive（7年蓄積） | 合計 |
|---|---|---|---|
| 10GB/月 | $0.20 | $0.01 | $0.21 |
| 50GB/月 | $1.00 | $0.06 | $1.06 |
| 100GB/月 | $2.00 | $0.12 | $2.12 |

### トランザクション料金

| 操作 | 単価 | 月間推定 |
|---|---|---|
| Write（日次） | $0.05/1000 回 | ~$1.50 |
| Read（日次 + テスト） | $0.0004/1000 回 | ~$0.20 |

**推定月額（50GB 程度）：約 $2.50 / 月**

## トラブルシューティング

### エラー: Permission denied

原因：サービスアカウントの権限不足

```bash
gcloud projects get-iam-policy care-record-backup \
  --flatten="bindings[].members" \
  --filter="bindings.members:care-record-backup@*"
```

### エラー: Bucket Lock already enabled

理由：Bucket Lock は一度有効にすると無効化できません。テスト環境で事前検証。

### データ取得が遅い

Standard で 90日以上前のデータを読み出している可能性。Archive アクセスは 10 秒程度が通常。

## セキュリティチェックリスト

- [ ] バケットは非公開（アクセス制限）
- [ ] サービスアカウントキーは /etc/secrets 配下
- [ ] Bucket Lock が Archive に適用されている
- [ ] ライフサイクルポリシーが正しく設定されている
- [ ] CRON_SECRET は十分にランダム（32文字以上）
- [ ] 月次復旧テストが完了している

## 参考資料

- [Google Cloud Storage classes](https://cloud.google.com/storage/docs/storage-classes)
- [Google Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [Google Cloud Bucket Lock](https://cloud.google.com/storage/docs/bucket-lock)
- [google-cloud-storage Node.js クライアント](https://cloud.google.com/nodejs/docs/reference/storage/latest)
