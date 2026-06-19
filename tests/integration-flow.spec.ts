import { test, expect } from '@playwright/test';
import { generateUser, setupNewOrg, clickMenu } from './helpers';

test.describe('統合フロー', () => {
  test.slow();

  test('招待から記録・承認までの一連の流れ', async ({ page }) => {
    const admin = generateUser();
    const staffEmail = `staff-${Date.now()}@example.com`;
    const staffName = '新人ヘルパー';

    // ----------------------------------------------------
    // [管理者パート] アカウント作成〜招待
    // ----------------------------------------------------
    console.log('--- 管理者パート開始 ---');
    await setupNewOrg(page, admin);

    // 1. 利用者作成
    await clickMenu(page, '利用者管理');
    await page.getByRole('button', { name: '新規登録' }).click();
    await page.getByLabel('利用者氏名').fill('佐藤 次郎');
    await page.getByRole('button', { name: '登録', exact: true }).click();
    await expect(page.getByText('佐藤 次郎')).toBeVisible({ timeout: 20000 });

    // 2. 招待リンクの発行
    await clickMenu(page, 'スタッフ管理');
    await page.getByRole('button', { name: '招待' }).click();
    
    // ダイアログ表示待ち
    await expect(page.getByRole('dialog')).toBeVisible();

    // ★修正: 権限選択 (getByLabelを使用)
    await page.getByLabel('権限').click(); 
    await page.getByRole('option', { name: '管理者' }).click();

    await page.getByRole('button', { name: '発行' }).click();
    
    // 招待リンクの取得
    const inviteUrl = await page.locator('input[value^="http"]').inputValue();
    expect(inviteUrl).toContain('/join?code=');
    console.log('招待リンク取得完了:', inviteUrl);

    // ダイアログを閉じてログアウト
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    
    await clickMenu(page, 'ログアウト');
    await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible({ timeout: 20000 });


    // ----------------------------------------------------
    // [スタッフパート] 招待受諾〜記録作成
    // ----------------------------------------------------
    console.log('--- スタッフパート開始 ---');
    
    // 3. 招待リンクへアクセス
    await page.goto(inviteUrl);

    // 4. スタッフとして新規登録
    await page.getByRole('tab', { name: '新規登録' }).click();
    await page.getByLabel('メールアドレス').fill(staffEmail);
    await page.getByLabel('パスワード').fill('Test!1234');
    await page.getByRole('button', { name: 'アカウントを作成' }).click();

    // 5. セットアップ (参加フロー)
    await page.waitForURL('**/setup?inviteCode=*');
    await page.getByLabel('氏名').fill(staffName);
    await page.getByRole('button', { name: '次へ進む' }).click();

    await expect(page.getByRole('heading', { name: '事業所に参加' })).toBeVisible();
    await page.getByRole('button', { name: '参加する' }).click();

    // 6. アプリ画面へ遷移
    // 記録メニューへ移動
    await clickMenu(page, '記録を作成');
    await expect(page.getByText('記録を作成する利用者を選択')).toBeVisible();
    
    // 7. 記録作成
    await page.getByText('佐藤 次郎 様').click();
    
    // デフォルトで自分の名前が入っているか確認 (チップ等で表示されているか)
    await expect(page.getByText(staffName).first()).toBeVisible();
    
    // 入力して送信
    await page.getByLabel('サービス(h)').fill('1');
    await page.getByRole('button', { name: '送信' }).click();

    // 送信後、一覧画面に戻ったことを確実に待つ
    await expect(page.getByText('記録を作成する利用者を選択')).toBeVisible({ timeout: 20000 });
    console.log('記録送信完了');

    // ログアウト
    await clickMenu(page, 'ログアウト');
    await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible({ timeout: 20000 });


    // ----------------------------------------------------
    // [管理者パート] 承認
    // ----------------------------------------------------
    console.log('--- 管理者パート（承認）開始 ---');

    // 8. 管理者で再ログイン
    await page.getByLabel('メールアドレス').fill(admin.email);
    await page.getByLabel('パスワード').fill(admin.password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();

    // 9. レポート承認
    await clickMenu(page, '提供記録一覧');
    
    // 未承認の記録があるはず
    await expect(page.getByText('未承認')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(staffName)).toBeVisible();

    // 詳細を開いて承認
    await page.getByRole('button', { name: '詳細' }).first().click();
    const approveButton = page.getByRole('button', { name: /承認(する)?$/ });
    await approveButton.click();

    // ステータス確認
    await expect(page.getByText('承認済')).toBeVisible({ timeout: 20000 });
    console.log('承認完了');
  });
});
