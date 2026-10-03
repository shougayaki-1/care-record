import { test, expect, type Locator } from '@playwright/test';
import { clickMenu, generateUser, registerClient, registerStaff, setupNewOrg } from './helpers';

async function checkActions(actions: Locator) {
  await expect(actions).toBeVisible();
  const result = await actions.evaluate((row) => {
    const buttons = Array.from(row.querySelectorAll('button'));
    const labels = buttons.flatMap((button) => Array.from(button.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()).map((node) => {
      const range = document.createRange(); range.selectNodeContents(node);
      return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
    }));
    row.scrollLeft = 0;
    const firstReachable = buttons[0].getBoundingClientRect().left >= row.getBoundingClientRect().left - 1;
    row.scrollLeft = row.scrollWidth;
    const lastReachable = buttons.at(-1)!.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1;
    row.scrollLeft = 0;
    return { labels, firstReachable, lastReachable };
  });
  expect(result.labels.every((lines) => lines === 1)).toBe(true);
  expect(result.firstReachable && result.lastReachable).toBe(true);
}

test('通常記録で共通ヘッダーと狭幅フォームを利用する', async ({ page }) => {
  test.slow();
  const user = generateUser();
  await setupNewOrg(page, user);
  await registerStaff(page, user.name, user.email);
  await registerClient(page, 'UI確認 利用者');

  await clickMenu(page, '記録を作成');
  await page.getByText('UI確認 利用者 様').click();
  // The client card already has this heading while navigation is in flight.
  // Wait for the actual record route and its actions before resizing the page.
  await expect(page).toHaveURL(/\/app\/record\/[^/?]+(?:\?.*)?$/, { timeout: 30000 });
  await expect(page.getByRole('group', { name: '記録操作' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'UI確認 利用者 様' })).toBeVisible();
  for (const width of [240, 320, 375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await checkActions(page.getByRole('group', { name: '記録操作' }));
    for (const label of ['開始日時', '終了日時']) {
      const input = page.getByLabel(label, { exact: true });
      await expect(input).toBeVisible();
      const bounds = await input.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  }

});
