# ドメイン戦略と基盤設定

作成日: 2026-06-25

## 概要

事業所の DX 基盤として、「shoug.org」ドメイン（安部祥太朗所有）を活用します。本文書では、ドメイン配置、DNS 設定、メール基盤、セキュリティ方針をまとめます。

## ドメイン構成図

```
shoug.org（ルートドメイン）
├─ www.shoug.org → Webサイト（Vercel）
├─ care-record.shoug.org → Care Record（既存、Vercel）
├─ mail.shoug.org → メール関連設定（オプション）
└─ admin.shoug.org → 管理画面アクセス（オプション）

Gmail/Google Workspace
└─ staff@shoug.org → スタッフメール等（別途決定）
```

## 各サブドメインの役割

| サブドメイン | 用途 | ホスティング | SSL | 管理者 |
|---|---|---|---|---|
| **www.shoug.org** | 公開Webサイト（施設紹介） | Vercel | Let's Encrypt（自動） | IT 担当者 |
| **care-record.shoug.org** | Care Record システム | Vercel | Let's Encrypt（自動） | IT 担当者 |
| **mail.shoug.org** | メール設定用（参考用） | Google Workspace | Google 管理 | Google Workspace 管理者 |
| **admin.shoug.org** | 将来：管理ポータル | 未決定 | 未決定 | 未決定 |

## DNS 設定

### A レコード

```
www.shoug.org  A  76.76.19.165  # Vercel のグローバル IP
care-record.shoug.org  A  76.76.19.165  # Vercel
```

### CNAME レコード

```
www  CNAME  cname.vercel.com
care-record  CNAME  cname.vercel.com
```

### TXT レコード（メール認証）

Google Workspace との連携時に設定。詳細は「Google Workspace 設定ガイド」参照。

```
_dmarc.shoug.org  TXT  "v=DMARC1; p=none"
```

### MX レコード（メール受信）

Google Workspace 導入時：

```
shoug.org  MX  5   gmail-smtp-in.l.google.com
shoug.org  MX  10  alt1.gmail-smtp-in.l.google.com
```

詳細は Google Workspace 設定ガイドで指示。

## SSL/TLS 証明書

### Vercel 自動管理

- www.shoug.org と care-record.shoug.org の SSL 証明書は Vercel が自動取得・更新
- Let's Encrypt 経由で、有効期限は 90 日ごとに自動更新
- ユーザー側での手作業不要

### 証明書確認

```bash
# 以下のコマンドで、証明書の有効期限を確認可能
openssl s_client -connect www.shoug.org:443 -servername www.shoug.org
```

## セキュリティ設定

### HSTS（HTTP Strict Transport Security）

Vercel で自動設定されるが、明示的に以下を確認：

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

### DNSSEC

将来的な設定対象。現在は未対応。

### CAA レコード（認証局の制限）

```
shoug.org  CAA  0  issue "letsencrypt.org"
```

## メール戦略

### 現在の構成

- **個人メール利用** — Gmail（shougayaki2008.icloud.com@gmail.com 等）
- **事業所メール** — 未実装

### Google Workspace 導入時

以下のメールアドレスが利用可能になります（オプション）：

```
info@shoug.org        → 代表問い合わせ
admin@shoug.org       → 事業所管理者
staff@shoug.org       → スタッフ用（users.shoug.org で個別割当）
backup@shoug.org      → バックアップ通知用
```

詳細は「Google Workspace 設定ガイド」参照。

## ドメイン登録・更新管理

### 登録情報

- **ドメイン** — shoug.org
- **レジストラ** — GoDaddy（推定）
- **所有者** — 安部祥太朗
- **更新期間** — 年 1 回（自動更新推奨）
- **有効期限** — 2027-02-08（更新予定日）
- **料金** — 年 $11.20

### 更新手順

1. レジストラ（GoDaddy 等）で「自動更新」を有効化
2. 年 1 回、自動更新料金が請求される
3. 更新完了の通知を確認

### DNS 管理者

- **現在** — Nominet/レジストラの DNS サービス
- **今後の検討** — Google Domains, Cloudflare 等への移行も可能

## サブドメイン追加時の手順

新しいサブドメイン（例：future.shoug.org）を追加する場合：

1. **Vercel 側**
   - プロジェクト設定で新しいドメインを追加
   - Vercel が CNAME 設定を指示

2. **DNS 側**
   - レジストラの DNS 設定で CNAME を追加
   - 伝播待機（通常 5-30 分）

3. **SSL 証明書**
   - Vercel が自動取得

## トラブルシューティング

### Webサイトにアクセスできない

```bash
# DNS 確認
nslookup www.shoug.org

# 応答が 76.76.19.165 なら OK
# 応答がない、または異なる IP の場合は DNS 設定を確認
```

### メール関連エラー

Google Workspace 導入後、メール送信に失敗する場合：

1. MX レコードが正しく設定されているか確認
2. SPF / DKIM / DMARC レコードが設定されているか確認
3. Google Workspace 管理画面で「ドメイン確認」が完了しているか確認

## ドメイン所有者による管理事項

### 定期確認（年 1 回）

- [ ] ドメイン有効期限の確認（自動更新有効か）
- [ ] 登録情報の更新（住所、連絡先の変更があれば）
- [ ] セキュリティ設定の見直し

### ドメイン移行（将来）

shoug.org を他のレジストラや管理体制に移行する場合：

1. ドメインロック状態の確認（移行中は施錠状態で、転出防止）
2. 認証コード（Authorization Code）の取得
3. 新しいレジストラで移行申請
4. DNS 設定の同期化（ダウンタイムなし）

詳細な手順は、その時点で IT 担当者に相談してください。

## 参考資料

- [Vercel — ドメイン接続](https://vercel.com/docs/concepts/projects/domains)
- [Google Workspace — DNS 設定](https://support.google.com/a/answer/174125)
- [DNSSEC について](https://www.icann.org/dnssec/)
