import { test, expect } from '@playwright/test';

test.describe('認証フォームのテスト', () => {
  test('CSPが許可していない外部接続をブラウザで拒否する', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain('connect-src');
    const directive = await page.evaluate(() => new Promise<string>(resolve => {
      const onViolation = (event: SecurityPolicyViolationEvent) => {
        if (event.blockedURI.startsWith('https://csp-denied.invalid')) {
          document.removeEventListener('securitypolicyviolation', onViolation);
          resolve(event.effectiveDirective);
        }
      };
      document.addEventListener('securitypolicyviolation', onViolation);
      // CSP must reject this request before DNS or any external connection.
      void fetch('https://csp-denied.invalid/blocked').catch(() => {});
    }));
    expect(directive).toBe('connect-src');
  });
  
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
