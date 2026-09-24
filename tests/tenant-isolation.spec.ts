import { expect, test } from '@playwright/test';
import { clickMenu, generateUser, logout, registerClient, setupNewOrg } from './helpers';

test('a different organization cannot read a client by its direct URL', async ({ page }) => {
  const firstOrgUser = generateUser();
  const privateClientName = `組織境界 ${generateUser().name}`;
  await setupNewOrg(page, firstOrgUser);
  await registerClient(page, privateClientName);
  const privateClientPath = new URL(page.url()).pathname;

  await logout(page);
  const secondOrgUser = generateUser();
  await setupNewOrg(page, secondOrgUser);
  await clickMenu(page, '利用者管理');
  await expect(page.getByRole('heading', { name: '利用者管理' })).toBeVisible();
  await expect(page.getByText(privateClientName, { exact: false })).toHaveCount(0);

  await page.goto(privateClientPath);
  await expect(page.getByRole('button', { name: '設定を保存' })).toBeVisible();
  await expect(page.getByRole('heading', { name: `${privateClientName} 様` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: secondOrgUser.orgName })).toBeVisible();
});
