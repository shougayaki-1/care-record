import { expect, test } from '@playwright/test';
import { clickMenu, generateUser, registerClient, setupNewOrg } from './helpers';

test.describe('記録画面の切替', () => {
  test('別の利用者の記録画面へ移動しても前の利用者の内容を表示しない', async ({ page }) => {
    const user = generateUser();
    const firstClient = '切替確認 利用者A';
    const secondClient = '切替確認 利用者B';

    await setupNewOrg(page, user);
    await registerClient(page, firstClient);
    await registerClient(page, secondClient);

    await clickMenu(page, '記録を作成');
    await expect(page.getByText('利用者を選択')).toBeVisible();

    await page.getByText(`${firstClient} 様`).click();
    await expect(page.getByRole('heading', { name: `${firstClient} 様` })).toBeVisible();

    await page.goBack();
    await expect(page.getByText('利用者を選択')).toBeVisible();

    await page.getByText(`${secondClient} 様`).click();
    await expect(page.getByRole('heading', { name: `${secondClient} 様` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${firstClient} 様` })).toHaveCount(0);
  });
});
