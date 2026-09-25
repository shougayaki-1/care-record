import { test, expect } from '@playwright/test';
import { generateUser, setupNewOrg, clickMenu, registerClient } from './helpers';

test.describe('管理者機能', () => {

  test('利用者の登録とフォーム設定の変更', async ({ page }) => {
    const user = generateUser();
    const clientName = 'テスト利用者A';

    await setupNewOrg(page, user);

    // 1. 利用者を登録（成功すると詳細設定ページ ?setup=1 へ自動遷移する）
    await registerClient(page, clientName);
    await expect(page.getByText('利用者を追加しました。記録フォーム、担当スタッフ、帳票・連携の順に設定してください。')).toBeVisible();

    // 2. 記録フォームタブで新しい項目を追加
    await page.getByRole('button', { name: '下に追加' }).last().click();
    await page.getByLabel('質問内容').last().fill('テスト独自の記録項目');

    // 3. 保存
    await page.getByRole('button', { name: '設定を保存' }).click();
    await expect(page.getByText('フォーム設定を保存しました！')).toBeVisible({ timeout: 15000 });

    // 4. 一覧に登録した利用者が表示されている
    await clickMenu(page, '利用者管理');
    await expect(page.getByRole('heading', { name: '利用者管理' })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(clientName) })
      .or(page.getByRole('listitem').filter({ hasText: clientName })).first()).toBeVisible({ timeout: 15000 });
  });

  test('セットアップ直後のアプリ初期表示', async ({ page }) => {
    const user = generateUser();
    await setupNewOrg(page, user);

    // 事業所作成直後は記録作成ページに着地する
    await expect(page).toHaveURL(/\/app\/record/);
    await expect(page.getByText('利用者を選択')).toBeVisible({ timeout: 15000 });

    // オーナーには管理メニューが表示される
    const menuButton = page.getByRole('button', { name: 'メニューを開く' });
    if (await menuButton.isVisible()) await menuButton.click();
    await expect(page.getByRole('link', { name: '利用者管理', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'スタッフ(名簿)管理', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'アカウント・権限管理', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '未承認・差戻し', exact: true })).toBeVisible();
  });
});
