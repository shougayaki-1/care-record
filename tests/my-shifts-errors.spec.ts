import { expect, test } from '@playwright/test';
import { clickMenu, generateUser, registerStaff, setupNewOrg } from './helpers';

// CI は next build + next start を使うため、実際の production Action transport を通る。
test('自分のシフト: 未紐付けとシフト0件を区別し、React #441 を表示しない', async ({ page }) => {
  test.slow();
  const user = generateUser();
  await setupNewOrg(page, user);
  await clickMenu(page, '自分のシフト');
  await expect(page.getByRole('alert').filter({ hasText: 'この事業所にスタッフとして紐付いていません' })).toBeVisible();
  await expect(page.getByText('この月のシフトはありません')).toBeHidden();
  await expect(page.getByRole('button', { name: 'ログアウトしてやり直す' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Minified React error');
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'スタッフとして紐付いていません' })).toBeVisible();

  await registerStaff(page, user.name, user.email);
  await clickMenu(page, '自分のシフト');
  await expect(page.getByText('この月のシフトはありません')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログアウトしてやり直す' })).toBeHidden();
  await expect(page.locator('body')).not.toContainText('Minified React error');
});
