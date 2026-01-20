import { Page, expect } from '@playwright/test';

export const generateUser = () => {
  const id = Date.now().toString().slice(-6);
  return {
    email: `user${id}@example.com`,
    password: 'password123',
    name: `User ${id}`,
    orgName: `Org ${id}`
  };
};

export const setupNewOrg = async (page: Page, user: ReturnType<typeof generateUser>) => {
  await page.goto('http://localhost:3000');
  
  await page.getByRole('tab', { name: '新規登録' }).click();
  await page.getByLabel('メールアドレス').fill(user.email);
  await page.getByLabel('パスワード').fill(user.password);
  await page.getByRole('button', { name: 'アカウントを作成' }).click();

  await expect(page.getByText('ようこそ！')).toBeVisible({ timeout: 15000 });
  
  await page.getByLabel('氏名').fill(user.name);
  await page.getByRole('button', { name: '次へ進む' }).click();

  await expect(page.getByText('事業所の設定')).toBeVisible();
  await page.getByText('新しい事業所を作成する').click();
  
  await expect(page.getByText('事業所の作成')).toBeVisible();
  await page.getByLabel('事業所名').fill(user.orgName);
  await page.getByRole('button', { name: '作成して開始' }).click();

  // 4. ダッシュボード遷移確認
  await expect(page.getByText('本日の概況')).toBeVisible({ timeout: 30000 });

  // ★追加: 利用規約モーダルが表示されていたら同意して閉じる
  const agreeButton = page.getByRole('button', { name: '同意してサービスを利用する' });
  if (await agreeButton.isVisible()) {
    const checkbox = page.getByRole('checkbox');
    if (await checkbox.isVisible()) {
        await checkbox.check();
    }
    await agreeButton.click();
    await expect(agreeButton).toBeHidden();
  }

  // ★修正: 重複エラー回避のため、可視状態の要素のみを対象にする
  // locator('text=... >> visible=true') という書き方でフィルタリングできます
  await expect(page.locator('text=アカウント設定 >> visible=true')).toBeVisible({ timeout: 10000 });
};

// メニューをクリックするヘルパー（モバイル対応）
export const clickMenu = async (page: Page, name: string) => {
  const menuButton = page.getByRole('button', { name: 'CareRecord' }).locator('..').getByRole('button').first();
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
  
  // ★修正: ここも同様に可視要素のみをクリック対象にする
  const menuItem = page.locator(`text=${name} >> visible=true`);
  await menuItem.click();
};