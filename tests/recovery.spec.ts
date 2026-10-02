import { expect, test } from '@playwright/test';
import { acceptTerms, generateUser, login, logout, setupNewOrg, signUp } from './helpers';

test.describe('独立復旧ページ', () => {
  test('JavaScript 無効でも POST で Cookie を破棄できる', async ({ browser }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL as string;
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    try {
      const authKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0]}-auth-token`;
      await context.addCookies([
        { name: `${authKey}.0`, value: 'invalid-session', url: baseURL, httpOnly: true },
        { name: `${authKey}.1`, value: 'invalid-session', url: baseURL, httpOnly: true },
        { name: 'su_grant', value: 'stale-grant', url: baseURL, httpOnly: true },
        { name: 'unrelated-app', value: 'keep', url: baseURL },
      ]);
      const page = await context.newPage();
      await page.goto('/api/auth/recover');
      // GET leaves the session unchanged.
      expect((await context.cookies()).some(cookie => cookie.name === `${authKey}.0`)).toBe(true);
      await page.getByRole('button', { name: 'ログアウトしてやり直す' }).click();
      await expect(page.getByRole('heading', { name: 'ログアウトしました' })).toBeVisible();
      const names = (await context.cookies()).map(cookie => cookie.name);
      expect(names).not.toContain(`${authKey}.0`);
      expect(names).not.toContain(`${authKey}.1`);
      expect(names).not.toContain('su_grant');
      expect(names).toContain('unrelated-app');
      await expect(page.getByRole('link', { name: 'ログイン画面へ戻る' })).toHaveAttribute('href', '/');
    } finally {
      await context.close();
    }
  });

  test('アプリ状態・古いチャンクキャッシュを削除してログイン画面へ hard navigation する', async ({ page }) => {
    await page.goto('/api/auth/recover');
    await page.evaluate(async () => {
      Reflect.set(window, '__careRecordRecoveryTest', true);
      localStorage.setItem('care-record-sidebar-open', 'false');
      sessionStorage.setItem('care-record-sidebar-open', 'false');
      localStorage.setItem('unrelated-app', 'keep');
      const cache = await caches.open('recovery-old-chunks');
      await cache.put('/_next/static/old-chunk.js', new Response('stale'));
    });
    await page.getByRole('button', { name: 'ログアウトしてやり直す' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
    const state = await page.evaluate(async () => ({
      sidebar: localStorage.getItem('care-record-sidebar-open'),
      sessionSidebar: sessionStorage.getItem('care-record-sidebar-open'),
      unrelated: localStorage.getItem('unrelated-app'),
      caches: await caches.keys(),
      previousDocument: Reflect.has(window, '__careRecordRecoveryTest'),
    }));
    expect(state.sidebar).toBeNull();
    expect(state.sessionSidebar).toBeNull();
    expect(state.unrelated).toBe('keep');
    expect(state.caches).not.toContain('recovery-old-chunks');
    expect(state.previousDocument).toBe(false);
  });
});

test('所属なしのアカウントからログアウトし、別アカウントの事業所で入り直せる', async ({ page }) => {
  test.setTimeout(120_000);
  const member = generateUser();
  await setupNewOrg(page, member);
  await logout(page);

  const noMembership = generateUser();
  await signUp(page, noMembership.email, noMembership.password);
  await acceptTerms(page);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/setup(?:\?|$)/);
  await page.getByRole('button', { name: '別のアカウントでログインする' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();

  await login(page, member.email, member.password);
  await expect(page.getByRole('button', { name: member.orgName })).toBeVisible();
});
