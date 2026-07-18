import { test, expect } from '@playwright/test';
import { registerTermsHandler, signUp } from './helpers';

// 毎回異なるメールアドレスを生成する関数
const randomEmail = () => `test-${Date.now()}@example.com`;

test.describe('セットアップウィザード', () => {

  test('新規登録から事業所作成までのフロー', async ({ page }) => {
    const email = randomEmail();
    const password = 'Test!1234';
    const userName = 'テスト太郎';
    const orgName = 'テスト事業所自動作成';

    // 1. トップページへ
    await page.goto('http://localhost:3000');
    // 利用規約モーダルはいつ開いてもよいよう自動処理する
    await registerTermsHandler(page);

    // 2. 新規登録 → /setup へ
    await signUp(page, email, password);

    // 3. プロフィール入力（handle_new_user が氏名を補完するため通常スキップ）
    const welcome = page.getByText('ようこそ！');
    const choice = page.getByText('事業所の設定');
    await expect(welcome.or(choice).first()).toBeVisible({ timeout: 30000 });
    if (await welcome.isVisible()) {
      await page.getByLabel('氏名').fill(userName);
      await page.getByRole('button', { name: '次へ進む' }).click();
    }

    // 4. 選択画面
    await expect(page.getByText('事業所の設定')).toBeVisible();
    await page.getByText('新しい事業所を作成する').click();

    // 5. 事業所作成画面
    await expect(page.getByText('事業所の作成')).toBeVisible();
    await page.getByLabel('事業所名').fill(orgName);
    await page.getByRole('button', { name: '作成して開始' }).click();

    // 6. アプリ画面（/app → /app/record 自動遷移）へ
    await expect(page).toHaveURL(/\/app(?:\/record)?$/, { timeout: 30000 });

    // 7. ヘッダーに事業所名が表示される
    await expect(page.getByRole('button', { name: orgName })).toBeVisible({ timeout: 15000 });
  });
});
