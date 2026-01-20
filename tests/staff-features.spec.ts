import { test, expect } from '@playwright/test';
import { generateUser, setupNewOrg, clickMenu } from './helpers';

test.describe('スタッフ機能（記録作成）', () => {
  test.slow();

  test('日報の作成と送信', async ({ page }) => {
    const user = generateUser();
    await setupNewOrg(page, user);

    // 事前準備：利用者作成
    await clickMenu(page, '利用者管理');
    await expect(page.getByRole('heading', { name: '利用者管理' })).toBeVisible();

    await page.getByRole('button', { name: '新規登録' }).click();
    await page.getByLabel('利用者氏名').fill('鈴木 花子');
    await page.getByRole('button', { name: '登録', exact: true }).click();
    
    await expect(page.getByText('鈴木 花子')).toBeVisible({ timeout: 20000 });

    // 1. 記録作成ページへ
    await clickMenu(page, '記録を作成');
    await expect(page.getByText('記録を作成する利用者を選択')).toBeVisible();
    
    await page.getByText('鈴木 花子 様').click();
    await expect(page.getByRole('heading', { name: '鈴木 花子 様' })).toBeVisible();

    // 2. 記録入力
    // ★修正: デフォルトで自分が選択されていることを確認する
    // （プレースホルダーによる検索やクリック操作を削除）
    await expect(page.getByText(user.name).first()).toBeVisible();

    await page.getByLabel('サービス(h)').fill('1.5');
    await page.getByLabel('移動(h)').fill('0.5');

    await page.locator('input[type="checkbox"]').first().check();

    // 3. 送信
    await page.getByRole('button', { name: '送信' }).click();
    await expect(page.getByText('記録を送信しました')).toBeVisible();

    // 4. 履歴ページへの遷移を確認
    await clickMenu(page, '自分の履歴');
    
    await expect(page.getByText('鈴木 花子').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('未承認').first()).toBeVisible();
  });
});