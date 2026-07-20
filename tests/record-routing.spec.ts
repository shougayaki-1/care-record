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

    const firstClientCard = page.getByText(`${firstClient} 様`);
    await expect(firstClientCard).toBeVisible({ timeout: 30_000 });
    await firstClientCard.click();
    await expect(page.getByRole('heading', { name: `${firstClient} 様` })).toBeVisible();

    // ブラウザの戻る操作(page.goBack())には依存しない。Next.js 16.2系のルーター
    // キャッシュには戻る/進む操作時に別の動的ルートの内容を誤って表示する既知の
    // 回帰があり(例: https://github.com/vercel/next.js/issues/92187)、
    // このテストが検証したい「別の利用者の記録画面へ移動しても前の利用者の
    // 内容を表示しない」こと自体とは無関係な失敗を招くため、サイドバーメニュー
    // から明示的に一覧へ再遷移する。
    await clickMenu(page, '記録を作成');
    await expect(page.getByText('利用者を選択')).toBeVisible();

    const secondClientCard = page.getByText(`${secondClient} 様`);
    await expect(secondClientCard).toBeVisible({ timeout: 30_000 });
    await secondClientCard.click();
    await expect(page.getByRole('heading', { name: `${secondClient} 様` })).toBeVisible();
    await expect(page.getByRole('heading', { name: `${firstClient} 様` })).toHaveCount(0);
  });
});
