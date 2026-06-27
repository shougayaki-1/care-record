# 招待フロー改善設計書

**作成日:** 2026-06-27  
**対象システム:** care-record  
**ステータス:** 承認済み

---

## 1. 背景・問題

### 1.1 バグ: 参加ボタンでエラー

`accept_invitation_atomic` DB関数が `ON CONFLICT (organization_id, user_id) DO NOTHING` という特定カラム指定構文を使っており、テーブルに対応する unique constraint が存在しない場合 PostgreSQL エラーが発生する。Next.js 本番ビルドはサーバーアクションのエラーをセキュリティのため隠蔽するため、ユーザーには "An error occurred in the Server Components render" と表示される。

また flexible_roles マイグレーションで以下が失われていた:
- `profiles.last_organization_id` の更新（参加後に事業所が自動選択されない）
- `already_member` 例外（サーバーアクション側が期待しているが新関数では発生しない）
- 監査ログの記録

### 1.2 UX 課題

- 招待リンクを開いても通常と同じログイン画面が表示されるため、招待が有効かどうかユーザーには分からない
- ログイン後のセットアップ画面でも「どの事業所からどのロールで」招待されているかが分からない

---

## 2. 設計

### 2.1 バグ修正: accept_invitation_atomic (新マイグレーション)

**変更点:**
- `ON CONFLICT (organization_id, user_id) DO NOTHING` → `ON CONFLICT DO NOTHING` (カラム指定なし、任意の constraint で動作)
- `already_member` チェックを復活（招待を無駄消費しない）
- `profiles.last_organization_id` 更新を復活
- 監査ログ記録を復活
- `SET search_path = ''` (最も制限的)
- role_ids の NULL チェック追加
- `UPDATE invitations ... WHERE id = v_inv.id` (より安全な特定)

### 2.2 新サーバーアクション: getInvitationPreview

**場所:** `src/app/actions/accounts.ts`  
**認証:** 不要 (supabaseAdmin で直接アクセス)  
**入力:** code: string  
**出力:**
```ts
{
  valid: boolean;
  orgName?: string;
  roleNames?: string[];
  expiresAt?: string;
}
```

プライバシー: 招待コードを知っている人に事業所名・ロール名を公開することは意図的。招待コード自体が認可の鍵。

### 2.3 招待ランディングページ (/join?code=xxx)

現状の "ローディング → 即リダイレクト" を改めて、招待詳細を表示する。

**画面構成:**
1. CareRecord ロゴ
2. 招待カード: 事業所名・ロール名・有効期限
3. 「ログインして参加」ボタン → `/?next=/setup?inviteCode=xxx`
4. 「新規登録して参加」ボタン → `/?register=1&next=/setup?inviteCode=xxx`
5. ローディング中は既存のスピナーを表示

**既ログイン時:** セッションチェック後、`/setup?inviteCode=xxx` に自動リダイレクト（現行動作を保持）

**無効/期限切れ:** エラーメッセージを表示し「ログインページへ」ボタンのみ

### 2.4 セットアップページの参加ステップ改善

`paramInviteCode` が存在する場合、`getInvitationPreview` を呼び出して事業所名・ロール名を表示する。

**join ステップの表示:**
```
[事業所アイコン] 
以下の事業所に参加します:
  事業所名: ○○事業所
  割り当てロール: 管理者、一般スタッフ
招待コード: xxxxxxxx

[参加する] [キャンセル]
```

コードが `paramInviteCode` から来る場合はテキストフィールドを読み取り専用で表示し、自分でコードを入力する場合は編集可能のまま。

### 2.5 AuthForm の招待コンテキスト

`next` パラメータに `inviteCode` が含まれる場合、ログイン/登録フォームの上部に招待バナーを表示:

```
┌─────────────────────────────────────────┐
│ 📋 招待リンクから参加します              │
│   ログインまたは新規登録してください     │
└─────────────────────────────────────────┘
```

`?register=1` パラメータがある場合は「新規登録」タブをデフォルト選択。

---

## 3. データフロー

```
/join?code=xxx
  ↓ (client: fetch preview + check session)
  ├─ ログイン済み → /setup?inviteCode=xxx
  └─ 未ログイン → ランディングページ表示
       ↓ ログイン/登録選択
       ↓ /?next=/setup?inviteCode=xxx [&register=1]
       AuthForm (招待バナー表示)
       ↓ 認証成功
       /setup?inviteCode=xxx
         ↓ join ステップで事業所名・ロール表示
         ↓ 参加するボタン
         acceptInvitation(code)
         ↓ accept_invitation_atomic (修正済)
         /app
```

---

## 4. ファイル変更一覧

| ファイル | 変更種別 | 内容 |
|---|---|---|
| `supabase/migrations/202606270001_fix_accept_invitation.sql` | 新規 | accept_invitation_atomic 修正 |
| `src/app/actions/accounts.ts` | 変更 | getInvitationPreview 追加 |
| `src/app/join/page.tsx` | 変更 | ランディングページ化 |
| `src/app/setup/page.tsx` | 変更 | join ステップに招待詳細表示 |
| `src/components/auth/AuthForm.tsx` | 変更 | 招待バナー + register タブ初期選択 |

---

## 5. スコープ外

- メールアドレスベースの招待（現在は招待コードのみ）
- 招待の複数事業所管理
- 招待の拒否機能
