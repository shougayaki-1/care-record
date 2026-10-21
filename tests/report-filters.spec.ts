import { expect, test } from '@playwright/test';
import { clickMenu, generateUser, registerClient, registerStaff, setupNewOrg } from './helpers';

test.describe('実績一覧の絞り込み保存', () => {
  test('ホームからの再訪、再読み込み、別タブで条件を復元し、リセットできる', async ({ page, context }) => {
    test.slow();
    const user = generateUser();
    await setupNewOrg(page, user);
    await registerStaff(page, user.name, user.email);
    const clientName = 'フィルター確認 利用者';
    await registerClient(page, clientName);
    await clickMenu(page, '記録を作成');
    await page.getByText(`${clientName} 様`, { exact: true }).click();
    await page.getByLabel('開始日時', { exact: true }).fill('2026-10-15T09:00');
    await page.getByLabel('終了日時', { exact: true }).fill('2026-10-15T10:00');
    await page.getByLabel('サービス提供').fill('1');
    await page.getByLabel('精算額').fill('0');
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('button', { name: '送信する', exact: true }).click();
    await expect(page.getByText('記録を送信しました')).toBeVisible();
    // clickMenu waits for the literal href, while reports immediately normalizes
    // restored filters into its URL. Navigate through the actual sidebar link
    // and assert the resulting filter UI instead.
    const openReports = async () => {
      const menu = page.getByRole('button', { name: 'メニューを開く' });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('link', { name: '全件表示', exact: true }).click();
      await expect(page.getByRole('button', { name: '絞り込みをリセット' })).toBeVisible();
    };
    await openReports();
    await page.getByRole('combobox', { name: '利用者', exact: true }).click();
    await page.getByRole('option', { name: clientName, exact: true }).click();
    await page.getByLabel('開始日', { exact: true }).fill('');
    await page.getByLabel('終了日', { exact: true }).fill('2026-10-20');
    await page.getByRole('combobox', { name: 'ステータス', exact: true }).click();
    await page.getByRole('option', { name: '承認待ち', exact: true }).click();
    const assertFilters = async (target: typeof page) => {
      await expect(target.getByRole('combobox', { name: '利用者', exact: true })).toHaveText(clientName);
      await expect(target.getByLabel('開始日', { exact: true })).toHaveValue('');
      await expect(target.getByLabel('終了日', { exact: true })).toHaveValue('2026-10-20');
      await expect(target.getByRole('combobox', { name: 'ステータス', exact: true })).toHaveText('承認待ち');
      await expect(target.getByText('検索結果: 1 件', { exact: true })).toBeVisible();
    };
    await assertFilters(page);
    await expect(page).toHaveURL(/recordStatus=pending/);
    await clickMenu(page, '記録を作成');
    await openReports();
    await assertFilters(page);
    await page.getByRole('button', { name: '詳細', exact: true }).first().click();
    await expect(page.getByText('記録の確認・承認')).toBeVisible();
    await openReports();
    await assertFilters(page);
    await page.reload();
    await assertFilters(page);

    const reopened = await context.newPage();
    await reopened.goto('/app/reports');
    await assertFilters(reopened);
    await reopened.close();

    // A successful bulk transition clears selection without changing filters.
    await page.getByRole('checkbox', { name: `${clientName}の記録を選択`, exact: true }).check();
    await page.getByRole('button', { name: '一括承認', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '承認する', exact: true }).click();
    await expect(page.getByText('一括承認しました', { exact: true })).toBeVisible();
    await expect(page.getByText('検索結果: 0 件', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '一括承認', exact: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'ステータス', exact: true })).toHaveText('承認待ち');
    await expect(page.getByLabel('終了日', { exact: true })).toHaveValue('2026-10-20');

    await page.getByRole('combobox', { name: 'ステータス', exact: true }).click();
    await page.getByRole('option', { name: '承認済', exact: true }).click();
    await expect(page.getByText('検索結果: 1 件', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: `${clientName}の記録を選択`, exact: true }).check();
    await page.getByRole('button', { name: '一括差戻し', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '差し戻す', exact: true }).click();
    await expect(page.getByText('差し戻しました', { exact: true })).toBeVisible();
    await expect(page.getByText('検索結果: 0 件', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '一括差戻し', exact: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'ステータス', exact: true })).toHaveText('承認済');

    await page.getByRole('button', { name: '絞り込みをリセット' }).click();
    await expect(page.getByRole('combobox', { name: '利用者', exact: true })).toHaveText('全員');
    await expect(page.getByLabel('終了日', { exact: true })).toHaveValue('');
    await expect(page).toHaveURL(/clientId=all/);
    await page.reload();
    await expect(page.getByRole('combobox', { name: '利用者', exact: true })).toHaveText('全員');
  });
});
