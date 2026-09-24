import { test, expect } from '@playwright/test';
import { acceptTerms, generateUser, setupNewOrg, clickMenu, logout, login, registerClient, registerStaff, signUp } from './helpers';

test.describe('統合フロー', () => {
  test.slow();

  test('招待から記録・承認までの一連の流れ', async ({ page }) => {
    const admin = generateUser();
    const staffEmail = `staff-${Date.now()}@example.com`;
    const staffName = '新人ヘルパー';
    const roleName = '記録スタッフ';

    // ----------------------------------------------------
    // [管理者パート] アカウント作成〜招待
    // ----------------------------------------------------
    await setupNewOrg(page, admin);

    // 1. 利用者とスタッフ名簿を準備
    await registerClient(page, '佐藤 次郎');
    await registerStaff(page, staffName);

    // 2. 記録の閲覧・作成を許可するロールを作成
    await clickMenu(page, 'アカウント・権限管理');
    await page.getByRole('tab', { name: 'ロール' }).click();
    await page.getByRole('button', { name: 'ロールを作成' }).click();
    const roleDialog = page.getByRole('dialog', { name: '新規ロール作成' });
    await roleDialog.getByLabel('ロール名').fill(roleName);
    // 「記録」行の 閲覧/作成 を「全体」に設定する
    const recordRow = roleDialog.getByRole('row', { name: /^記録/ });
    const recordControls = await recordRow.isVisible()
      ? recordRow
      : roleDialog.getByRole('heading', { name: '記録' }).locator('..');
    await recordControls.getByRole('button', { name: '全体' }).nth(0).click();
    await recordControls.getByRole('button', { name: '全体' }).nth(1).click();
    await roleDialog.getByRole('button', { name: '作成', exact: true }).click();
    await expect(page.getByText('ロールを作成しました')).toBeVisible({ timeout: 15000 });

    // 3. 招待リンクの発行（名前・メールアドレス・名簿紐付け・ロールを指定）
    await page.getByRole('tab', { name: 'アカウント' }).click();
    await page.getByRole('button', { name: '新しい人を招待' }).click();
    const inviteDialog = page.getByRole('dialog', { name: '新しいアカウントの招待' });
    await inviteDialog.getByText(roleName).click();
    await inviteDialog.getByLabel('招待する人の名前').fill(staffName);
    await inviteDialog.getByLabel('招待先メールアドレス').fill(staffEmail);
    await inviteDialog.getByLabel('スタッフ名簿との紐付け').click();
    await page.getByRole('option', { name: new RegExp(staffName) }).click();
    await inviteDialog.getByRole('button', { name: '招待リンクを発行' }).click();

    const inviteUrl = await inviteDialog.locator('input[value^="http"]').inputValue();
    expect(inviteUrl).toContain('/join?code=');
    await inviteDialog.getByRole('button', { name: '閉じる' }).click();
    await expect(inviteDialog).toBeHidden();

    await logout(page);

    // ----------------------------------------------------
    // [スタッフパート] 招待受諾〜記録作成
    // ----------------------------------------------------
    // 4. 招待リンクへアクセスし、招待メールアドレスで新規登録
    // /join は招待プレビュー画面であり、直接タブUIは持たない。
    // 「新規登録して参加」ボタンからルートのログイン/登録画面へ遷移する。
    await page.goto(inviteUrl);
    await page.getByRole('button', { name: '新規登録して参加' }).click();
    await signUp(page, staffEmail, 'Test!1234');
    await acceptTerms(page);

    // 5. セットアップ（参加フロー）。氏名はトリガー補完によりスキップされることがある
    const welcome = page.getByText('ようこそ！');
    const joinHeading = page.getByRole('heading', { name: '事業所に参加' });
    await expect(welcome.or(joinHeading).first()).toBeVisible({ timeout: 30000 });
    if (await welcome.isVisible()) {
      await page.getByLabel('氏名').fill(staffName);
      await page.getByRole('button', { name: '次へ進む' }).click();
    }
    await expect(joinHeading).toBeVisible();
    await expect(page.getByText(admin.orgName)).toBeVisible();
    await page.getByRole('button', { name: '参加する' }).click();
    await page.waitForURL('**/app/record', { timeout: 30000 });

    // 6. 記録作成（招待時の名簿紐付けにより担当スタッフが自動選択される）
    await clickMenu(page, '記録を作成');
    await expect(page.getByText('利用者を選択')).toBeVisible();
    await page.getByText('佐藤 次郎 様').click();
    await expect(page.getByRole('heading', { name: '佐藤 次郎 様' })).toBeVisible();
    await expect(page.getByText(staffName).first()).toBeVisible({ timeout: 15000 });

    await page.getByLabel('サービス提供').fill('1');
    await page.getByRole('button', { name: '送信' }).click();
    await page.getByRole('button', { name: '送信する' }).click();
    await expect(page.getByText('記録を送信しました')).toBeVisible({ timeout: 20000 });

    await logout(page);

    // ----------------------------------------------------
    // [管理者パート] 承認
    // ----------------------------------------------------
    // 7. 管理者で再ログイン
    await login(page, admin.email, admin.password);

    // 8. 未承認の記録を開いて承認
    await clickMenu(page, '未承認・差戻し');
    await expect(page.getByText('承認待ち').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(staffName).first()).toBeVisible();

    await page.getByRole('button', { name: '詳細' }).first().click();
    await expect(page.getByText('記録の確認・承認')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: '承認', exact: true }).click();
    await page.getByRole('button', { name: '承認する' }).click();
    await expect(page.getByText('承認しました')).toBeVisible({ timeout: 20000 });

    // 9. 記録一覧で承認済になっている
    await page.waitForURL('**/app/reports**', { timeout: 20000 });
    await expect(page.getByText('承認済').first()).toBeVisible({ timeout: 20000 });
  });
});
