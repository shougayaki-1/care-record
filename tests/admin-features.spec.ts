import { test, expect } from '@playwright/test';
// clickMenu をインポートに追加
import { generateUser, setupNewOrg, clickMenu } from './helpers';

test.describe('管理者機能', () => {
  
  test('利用者の登録とフォーム設定の変更', async ({ page }) => {
    const user = generateUser();
    const clientName = 'テスト利用者A';

    await setupNewOrg(page, user);

    // 1. 利用者管理ページへ (clickMenuを使用)
    await clickMenu(page, '利用者管理');
    
    // ページ遷移待ち
    await expect(page.getByRole('heading', { name: '利用者管理' })).toBeVisible();

    // 2. 新規登録
    await page.getByRole('button', { name: '新規登録' }).click();
    await page.getByLabel('利用者氏名').fill(clientName);
    await page.getByRole('button', { name: '登録', exact: true }).click();

    // リストに追加されたか確認 (タイムアウトを20秒に延長)
    await expect(page.getByText(clientName)).toBeVisible({ timeout: 20000 });

    // 3. フォーム設定へ移動
    await page.getByRole('row', { name: clientName }).getByRole('button').first().click();
    await expect(page.getByText('記録フォーム設定')).toBeVisible();

    // 4. 新しい項目を追加
    await page.getByRole('button', { name: '項目を追加する' }).click();
    
    const lastLabelInput = page.locator('input[value=""]').last();
    await lastLabelInput.fill('テスト独自の記録項目');
    
    await page.getByRole('button', { name: 'この設定を保存する' }).click();
    await expect(page.getByText('設定を保存しました！')).toBeVisible();
  });

  test('ダッシュボードの表示確認', async ({ page }) => {
    const user = generateUser();
    await setupNewOrg(page, user);

    await expect(page.getByText('本日の訪問予定')).toBeVisible();
    await expect(page.getByText('未承認の記録')).toBeVisible();
    await expect(page.getByText('スタッフ稼働中')).toBeVisible();
  });
});