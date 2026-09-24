import { test, expect } from '@playwright/test';

test.describe('認証フォームのテスト', () => {
  
  test('未登録アドレスでログインしようとするとエラーになる', async ({ page }) => {
    await page.goto('/');

    // 入力
    await page.getByLabel('メールアドレス').fill('nobody@example.com');
    await page.getByLabel('パスワード').fill('wrongpassword');
    
    // ボタンクリック
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();

    // エラーメッセージの出現を待機・確認
    const alert = page.locator('.MuiAlert-message');
    await expect(alert).toContainText('メールアドレスまたはパスワードが正しくありません');
  });

  test('バリデーション: パスワードが短すぎる場合', async ({ page }) => {
    await page.goto('/');
    
    // タブ切り替え
    await page.getByRole('tab', { name: '新規登録' }).click();

    await page.getByLabel('メールアドレス').fill('short@test.com');
    await page.getByLabel('パスワード').fill('123'); // 短い

    // HelperTextが表示されるか確認
    await expect(page.getByText('8文字以上で設定してください')).toBeVisible();
  });

});
