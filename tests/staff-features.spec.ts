import { test, expect } from '@playwright/test';
import { generateUser, setupNewOrg, clickMenu, registerClient, registerStaff } from './helpers';

test.describe('スタッフ機能（記録作成）', () => {
  test.slow();

  test('日報の作成と送信', async ({ page }) => {
    const user = generateUser();
    await setupNewOrg(page, user);

    // 事前準備1: 自分のアカウントに紐付いたスタッフを名簿へ登録する
    // （記録の担当スタッフはスタッフ名簿から選択されるため）
    // アカウント表示名は handle_new_user によりメールアドレスになっている
    await registerStaff(page, user.name, user.email);

    // 事前準備2: 利用者を登録（詳細設定ページへ自動遷移する）
    await registerClient(page, '鈴木 花子');

    // 1. 記録作成ページへ
    await clickMenu(page, '記録を作成');
    await expect(page.getByText('利用者を選択')).toBeVisible();
    await page.getByText('鈴木 花子 様').click();
    await expect(page.getByRole('heading', { name: '鈴木 花子 様' })).toBeVisible();

    // 2. 担当スタッフに自分（紐付けたスタッフ）がデフォルトで選択されている
    await expect(page.getByText(user.name).first()).toBeVisible({ timeout: 15000 });

    // 3. 記録を入力
    await page.getByLabel('サービス提供').fill('1.5');
    await page.getByLabel('移動', { exact: true }).fill('0.5');
    // チェック項目はSwitchFieldで描画される（環境によりrole=checkbox/switchのどちらにもなる）
    await page.getByRole('checkbox', { name: '水分補給' }).or(page.getByRole('switch', { name: '水分補給' })).first().check();

    // 4. 送信（確認ダイアログあり）
    await page.getByRole('button', { name: '送信' }).click();
    await page.getByRole('button', { name: '送信する' }).click();
    await expect(page.getByText('記録を送信しました')).toBeVisible({ timeout: 20000 });

    // 5. 自分の履歴に承認待ちの記録が表示される
    await clickMenu(page, '自分の履歴');
    await expect(page.getByText('鈴木 花子 様').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('承認待ち').first()).toBeVisible();
  });
});
