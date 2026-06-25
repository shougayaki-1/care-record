# 事業所向け公開Webサイト構築提案

作成日: 2026-06-25

## 提案の目的

Care Record と並行して、事業所の対外向けWebサイト（施設紹介サイト）を構築します。実地指導対応、採用情報提供、利用者・関係者の信頼醸成を実現します。

## サイトの位置付け

| 役割 | Care Record | 公開Webサイト |
|---|---|---|
| **用途** | 内部：提供記録管理 | 外部：施設紹介・情報提供 |
| **閲覧者** | スタッフ | 一般利用者、求職者、施設関係者 |
| **更新頻度** | 日次（運用） | 月次～不定期（営業・管理） |
| **ドメイン** | care-record.shoug.org | www.shoug.org |

## サイト構成（A型：施設紹介サイト）

### ページ構成案

```
www.shoug.org（ルート）
├─ / → トップページ（施設紹介、最新情報）
├─ /about → 施設概要
│   ├ 設立背景
│   ├ ミッション・ビジョン
│   ├ 組織図
│   └ 主要統計（利用者数、スタッフ数）
├─ /service → 提供サービス詳細
│   ├ 訪問介護
│   ├ 日中サービス
│   └ その他のサービス
├─ /team → スタッフ紹介（オプション）
│   ├ 代表挨拶
│   └ スタッフプロフィール
├─ /recruit → 採用情報
│   ├ 募集職種
│   ├ 勤務条件
│   ├ 応募フォーム
│   └ FAQ
├─ /news → お知らせ・ブログ
├─ /contact → お問い合わせフォーム
├─ /faq → よくある質問
└─ /privacy → プライバシーポリシー
```

### 各ページの主要内容

#### トップページ
- ヒーローイメージ（施設の写真または概念画）
- 施設名、キャッチフレーズ
- サービス概要（3-4行）
- 最新ニュース（3件）
- CTA（お問い合わせ、採用情報へのリンク）
- Contact セクション

#### 施設概要ページ
- 事業所名、設立日
- 代表者名
- 利用者数、スタッフ数
- 利用可能エリア
- 営業時間
- アクセス情報（地図）

#### サービスページ
- 提供サービス一覧
- 各サービスの詳細（対象者、内容、料金目安）
- 利用開始の流れ

#### 採用ページ
- 募集職種と勤務条件
- 給与・福利厚生
- 応募フォーム（Google Forms / Vercel Form）
- よくある質問

## 技術的な実装方針

### フレームワーク・ホスティング

| 項目 | 採用技術 | 理由 |
|---|---|---|
| **フレームワーク** | Next.js（App Router） | Care Record と同じ技術スタック、保守性向上 |
| **ホスティング** | Vercel | デプロイ簡単、SSL 自動、従量課金小 |
| **データベース** | 不要（静的コンテンツ） | または Google Sheets（お問い合わせ）で運用 |
| **ドメイン** | www.shoug.org | shoug.org のサブドメイン |

### ディレクトリ構成案

```
care-record/
├─ apps/website/  ← 新規追加
│  ├─ app/
│  │  ├─ (landing)/
│  │  │  ├─ page.tsx → トップ
│  │  │  ├─ about/page.tsx
│  │  │  ├─ service/page.tsx
│  │  │  ├─ recruit/page.tsx
│  │  │  ├─ contact/page.tsx
│  │  │  └─ ...
│  │  ├─ layout.tsx
│  │  └─ globals.css
│  ├─ public/
│  │  ├─ images/
│  │  └─ ...
│  ├─ package.json
│  ├─ next.config.ts
│  └─ vercel.json
└─ ...
```

別リポジトリとしても、同一リポジトリ内のモノレポとしても実装可能。推奨：**同一リポジトリ内の `apps/website`**（管理簡素化）

### 本番デプロイ

```bash
# GitHub push
git push origin feature/website

# Vercel が自動検知
# 1. ビルド
# 2. Preview デプロイ（PR URL）
# 3. Merge → Production デプロイ

# www.shoug.org で公開
```

## 外観・デザイン

### デザイン戦略

- **Color Scheme** — 事業所のカラーに合わせるか、シンプルな青×グレーで統一
- **Typography** — 日本語フォント（Google Fonts），見出しは sans-serif
- **Layout** — モバイルファースト。全ページレスポンシブ
- **Accessibility** — WCAG 2.1 AA 準拠（色覚障害対応、キーボード操作可）

### UI コンポーネント例

- ヘッダー（ナビゲーション、ロゴ）
- ヒーロー（大画像 + キャッチフレーズ）
- カード（サービス紹介、スタッフ紹介）
- フォーム（お問い合わせ、応募）
- フッター

Tailwind CSS + shadcn/ui で実装（Care Record と統一）

## 機能要件

### 必須機能

- [x] 静的ページレンダリング（SSG）
- [x] レスポンシブデザイン
- [x] お問い合わせフォーム（Google Forms / 簡易フォーム）
- [x] OGP メタタグ（SNS シェア対応）
- [x] robots.txt, sitemap.xml（SEO）

### オプション機能（Phase 2）

- [ ] ブログ機能（お知らせ更新）
- [ ] 多言語対応（英語等）
- [ ] ページビュー分析（Google Analytics）
- [ ] チャットボット（よくある質問）

## SEO 対策

### 基本設定

```typescript
// next.config.ts
export const metadata: Metadata = {
  title: '施設名 | 訪問介護・福祉サービス',
  description: '東京都渋谷区の訪問介護サービス。...',
  keywords: '訪問介護、福祉、東京',
  openGraph: {
    title: '施設名',
    description: '...',
    url: 'https://www.shoug.org',
    images: ['https://www.shoug.org/og-image.jpg']
  }
};
```

### 施策

- [ ] Google Search Console への登録
- [ ] sitemap.xml 提供
- [ ] robots.txt 設定
- [ ] 構造化データ（Schema.org / Organization, LocalBusiness）
- [ ] ページ速度最適化（Vercel Analytics 監視）

## 問い合わせ・応募の受付

### 方式 A：Google Forms（シンプル）

```
https://forms.gle/XXXXX
```

- 利点：セットアップ簡単、Google Sheets で自動記録
- 欠点：ブランディング性低い、カスタマイズ限定的

### 方式 B：Vercel Form（推奨）

```typescript
// src/app/contact/form.tsx
export default function ContactForm() {
  return (
    <form action="/api/contact" method="POST">
      <input name="name" placeholder="お名前" required />
      <input name="email" type="email" placeholder="メールアドレス" required />
      <textarea name="message" placeholder="お問い合わせ内容" required />
      <button type="submit">送信</button>
    </form>
  );
}
```

メール送信は Resend / SendGrid 等で実装。

## セキュリティ対策

### 基本設定

- [ ] HTTPS 自動化（Vercel 側で実施）
- [ ] CSP（Content-Security-Policy）ヘッダ設定
- [ ] X-Frame-Options: DENY（クリックジャッキング防止）
- [ ] X-Content-Type-Options: nosniff
- [ ] フォーム入力のサニタイズ（XSS 防止）

### プライバシー

- [ ] プライバシーポリシー（個人情報保護方針）ページ必須
- [ ] Google Analytics 使用時は同意表示（Cookie Banner）

## 料金と運用

### ホスティング料金

| 項目 | 内容 | 料金 |
|---|---|---|
| **Vercel Hobby（無料）** | 小規模サイト、月 100GB 帯域 | $0/月 |
| **Vercel Pro** | 優先サポート、分析機能 | $20/月 |

**推奨：Hobby（無料）で開始、必要に応じて Pro へ**

### DNS・ドメイン

- www.shoug.org は shoug.org サブドメイン
- 追加費用なし（既存ドメイン運用費用のみ）

### メール送信（問い合わせ通知）

| サービス | 無料枠 | 料金 |
|---|---|---|
| **Resend** | 100 通/日 | $20/月（有料プラン） |
| **SendGrid** | 100 通/日（永遠） | $0/月 |
| **Google Workspace** | Gmail 統合 | $6-12/user/月 |

**推奨：SendGrid（無料枠で十分）**

## スケジュール

### Phase 1：基本構築（2-3週）

- Webサイト設計・ワイヤーフレーム
- Next.js プロジェクト作成
- 基本ページ実装（トップ、about, service, contact）
- ローカルテスト完了

### Phase 2：デプロイ・運用開始（1週）

- Vercel へのデプロイ
- www.shoug.org ドメイン接続
- SSL 証明書取得（自動）
- 本番公開テスト

### Phase 3：機能追加（継続）

- ブログ機能（オプション）
- 分析導入（Google Analytics）
- SEO 最適化

## 参考資料

- [Next.js App Router](https://nextjs.org/docs/app)
- [Vercel Deployment](https://vercel.com/docs/concepts/deployments/overview)
- [Tailwind CSS](https://tailwindcss.com/)
- [SEO Starter Guide](https://developers.google.com/search/docs/beginner/seo-starter-guide)
