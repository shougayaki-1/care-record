import { test, expect } from '@playwright/test';

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

    // 2. 新規登録タブへ
    await page.getByRole('tab', { name: '新規登録' }).click();
    await page.getByLabel('メールアドレス').fill(email);
    await page.getByLabel('パスワード').fill(password);
    
    // 登録ボタンクリック
    await page.getByRole('button', { name: 'アカウントを作成' }).click();

    // 3. セットアップ画面（プロフィール入力）へ遷移したか確認
    // URLが /setup になるのを待つ
    await page.waitForURL('**/setup');
    await expect(page.getByText('ようこそ！')).toBeVisible();

    // 4. 名前入力
    await page.getByLabel('氏名').fill(userName);
    await page.getByRole('button', { name: '次へ進む' }).click();

    // 5. 選択画面
    await expect(page.getByText('事業所の設定')).toBeVisible();
    await page.getByText('新しい事業所を作成する').click();

    // 6. 事業所作成画面
    await expect(page.getByText('事業所の作成')).toBeVisible();
    await page.getByLabel('事業所名').fill(orgName);
    
    // 作成実行
    await page.getByRole('button', { name: '作成して開始' }).click();

    // 7. アプリ画面へ遷移したか確認
    await page.waitForURL('**/app/record');
    
    // ヘッダー等に事業所名が表示されているか確認（実装に合わせて調整）
    // await expect(page.getByText(orgName)).toBeVisible();
  });
});
