import { expect, test } from '@playwright/test';
import { generateUser, setupNewOrg } from './helpers';

test.describe('既存アカウントの所属解決', () => {
  test('再ログイン時にSETUPへ誤遷移しない', async ({ page }) => {
    const user = generateUser();
    await setupNewOrg(page, user);

    await page.getByRole('button', { name: 'アカウント' }).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();
    await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByLabel('メールアドレス').fill(user.email);
    await page.getByLabel('パスワード').fill(user.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();

    await page.waitForURL('**/app/record', { timeout: 30_000 });
    await expect(page).not.toHaveURL(/\/setup/);
    await expect(page.getByText(user.orgName).first()).toBeVisible();
  });
});
