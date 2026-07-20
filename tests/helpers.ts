import { Page, expect } from '@playwright/test';

export const generateUser = () => {
  const id = Date.now().toString().slice(-6);
  return {
    email: `user${id}@example.com`,
    password: 'Test!1234',
    name: `User ${id}`,
    orgName: `Org ${id}`
  };
};

/**
 * 利用規約モーダルはルートレイアウトのマウント時チェックで非同期に開くため、
 * どの操作中に現れてもクリックを遮る可能性がある。
 * addLocatorHandler で「表示されて操作を遮ったら同意して閉じる」を自動化する。
 */
export const registerTermsHandler = async (page: Page) => {
  const dialog = page.getByRole('dialog', { name: '利用規約への同意' });
  await page.addLocatorHandler(dialog, async () => {
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: '同意してサービスを利用する' }).click();
    await expect(dialog).toBeHidden();
  });
};

/** 新規登録タブからアカウントを作成し、/setup へ遷移するまで待つ */
export const signUp = async (page: Page, email: string, password: string) => {
  await page.getByRole('tab', { name: '新規登録' }).click();
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'アカウントを作成' }).click();
  await expect(page).toHaveURL(/\/setup(?:\?|$)/, { timeout: 30000 });
};

export const setupNewOrg = async (page: Page, user: ReturnType<typeof generateUser>) => {
  await page.goto('/?next=/setup');
  await registerTermsHandler(page);
  await signUp(page, user.email, user.password);

  // handle_new_user トリガーで profiles.name にメールアドレスが入るため、
  // 通常「ようこそ！」(氏名入力) はスキップされて「事業所の設定」から始まる。
  const welcome = page.getByText('ようこそ！');
  const choice = page.getByText('事業所の設定');
  await expect(welcome.or(choice).first()).toBeVisible({ timeout: 30000 });
  if (await welcome.isVisible()) {
    await page.getByLabel('氏名').fill(user.name);
    await page.getByRole('button', { name: '次へ進む' }).click();
    await expect(choice).toBeVisible();
  }

  await page.getByText('新しい事業所を作成する').click();
  await expect(page.getByText('事業所の作成')).toBeVisible();
  await page.getByLabel('事業所名').fill(user.orgName);
  await page.getByRole('button', { name: '作成して開始' }).click();

  // 組織作成直後はセッション活動の登録が反映されるまで待つ。
  // 一時障害の手動再試行画面が出た場合だけ、一度だけ UI から再試行する。
  const retryButton = page.getByRole('button', { name: '再試行', exact: true });
  const organizationSelector = page.getByRole('button', { name: user.orgName });
  const createRecordLink = page.getByRole('link', { name: '記録を作成', exact: true });
  const waitForWorkspaceReady = async () => {
    await expect.poll(
      async () => (
        await organizationSelector.isVisible()
        || await createRecordLink.isVisible()
        || await retryButton.isVisible()
      ),
      { timeout: 30_000 },
    ).toBe(true);
  };

  await waitForWorkspaceReady();
  if (await retryButton.isVisible()) {
    await retryButton.click();
    await waitForWorkspaceReady();
  }

  // /app はワークスペース解決後 /app/record へ自動リダイレクトされる
  await expect(page).toHaveURL(/\/app(?:\/record)?$/, { timeout: 30000 });
  if (new URL(page.url()).pathname === '/app') {
    await page.getByRole('link', { name: '記録を作成', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/record$/, { timeout: 30000 });
  }
  await expect(organizationSelector).toBeVisible({ timeout: 15000 });
};

// サイドバーのメニューをクリックするヘルパー（モバイル対応）
export const clickMenu = async (page: Page, name: string) => {
  const menuButton = page.getByRole('button', { name: 'メニューを開く' });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
  await page.getByRole('link', { name, exact: true }).click();
};

/** ヘッダーのアカウントメニューからログアウトし、ログイン画面へ戻るまで待つ */
export const logout = async (page: Page) => {
  await page.getByRole('button', { name: 'アカウント' }).click();
  await page.getByRole('menuitem', { name: 'ログアウト' }).click();
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible({ timeout: 20000 });
};

/** ログイン画面から既存アカウントでログインし、記録作成ページに入るまで待つ */
export const login = async (page: Page, email: string, password: string) => {
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/record$/, { timeout: 30000 });
};

/**
 * 利用者を新規登録する。
 * 登録成功でアプリは詳細設定ページ(/app/clients/{id}?setup=1)へ自動遷移する。
 */
export const registerClient = async (page: Page, name: string) => {
  await clickMenu(page, '利用者管理');
  await expect(page.getByRole('heading', { name: '利用者管理' })).toBeVisible();
  await page.getByRole('button', { name: '新規登録' }).click();
  await page.getByLabel('利用者氏名').fill(name);
  await page.getByRole('button', { name: '登録', exact: true }).click();
  await expect(page.getByText(`${name} 様`)).toBeVisible();
};

/** スタッフ(名簿)管理でスタッフを追加する。accountLabel を渡すとアカウント紐付けも行う */
export const registerStaff = async (page: Page, staffName: string, accountLabel?: string) => {
  await clickMenu(page, 'スタッフ(名簿)管理');
  await expect(page.getByText('現場スタッフ名簿')).toBeVisible();
  await page.getByRole('button', { name: 'スタッフを追加' }).click();
  const dialog = page.getByRole('dialog', { name: 'スタッフの追加' });
  await dialog.getByLabel('スタッフ名 (表示用)').fill(staffName);
  if (accountLabel) {
    await dialog.getByLabel('紐付けるアカウント (任意)').click();
    await page.getByRole('option', { name: accountLabel }).click();
  }
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(staffName).first()).toBeVisible({ timeout: 15000 });
};
