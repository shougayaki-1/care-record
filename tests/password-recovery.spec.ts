import { expect, test } from '@playwright/test';

test('ログイン画面から再設定メールの依頼画面に移動できる @mobile', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'パスワードを忘れた方' }).click();
  await expect(page).toHaveURL('/auth/forgot-password');
  await expect(page.getByRole('heading', { name: 'パスワードを忘れた方' })).toBeVisible();
  await expect(page.getByLabel('メールアドレス')).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByRole('link', { name: 'ログイン画面に戻る' })).toHaveAttribute('href', '/');
});

test('無効な再設定リンクは認証情報を残さず再送を案内する @mobile', async ({ page }) => {
  await page.goto('/auth/recovery-callback?code=invalid-login-code&next=https://evil.example');
  await expect(page).toHaveURL('/auth/reset-password?error=invalid_link');
  await expect(page.getByText('リンクが無効、または有効期限が切れています。再設定用メールをもう一度取得してください。')).toBeVisible();
  await expect(page.getByLabel(/^新しいパスワード[\s*]*$/)).toHaveCount(0);
  await page.getByRole('link', { name: '再設定用メールを再送する' }).click();
  await expect(page).toHaveURL('/auth/forgot-password');
});

test('メールのリンクで再設定し新しいパスワードでログインでき、使用済みリンクは拒否する @mobile', async ({ page, request, context }) => {
  const { createClient } = await import('@supabase/supabase-js');
  const { randomUUID } = await import('node:crypto');
  const email = `recovery-${randomUUID()}@example.com`;
  const original = 'Original-pass-123';
  const replacement = 'Replacement-pass-456';
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: createError } = await admin.auth.admin.createUser({ email, password: original, email_confirm: true });
  expect(createError).toBeNull();
  await page.goto('/auth/forgot-password');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByRole('button', { name: '再設定用メールを送信' }).click();
  await expect(page.getByText(/登録されているメールアドレスの場合/)).toBeVisible();
  await expect(page.getByRole('button', { name: /秒後に再送できます/ })).toBeDisabled();
  const mailbox = process.env.SUPABASE_MAILPIT_URL!;
  expect(new URL(mailbox).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  let messageId = '';
  await expect.poll(async () => {
    const response = await request.get(`${mailbox}/api/v1/messages`);
    const data = await response.json() as { messages: { ID: string; To: { Address: string }[] }[] };
    messageId = data.messages.find(message => message.To.some(recipient => recipient.Address === email))?.ID || '';
    return Boolean(messageId);
  }).toBe(true);
  const delivered = await (await request.get(`${mailbox}/api/v1/message/${messageId}`)).json() as { HTML: string };
  const link = delivered.HTML.match(/href="([^"]*\/auth\/recovery-callback[^\"]*)"/)?.[1]?.replaceAll('&amp;', '&');
  // Avoid printing the one-time credential in assertion errors.
  expect(Boolean(link)).toBe(true);
  await page.goto(link!);
  await expect(page).toHaveURL('/auth/reset-password');
  await page.getByLabel(/^新しいパスワード[\s*]*$/).fill(replacement);
  await page.getByLabel('新しいパスワード（確認）').fill(replacement);
  await page.getByRole('button', { name: 'パスワードを再設定', exact: true }).click();
  await expect(page).toHaveURL('/', { timeout: 30_000 });
  expect((await context.cookies()).some(cookie => cookie.name === 'cr_password_recovery')).toBe(false);
  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rejected = await verifier.auth.signInWithPassword({ email, password: original });
  expect(Boolean(rejected.error)).toBe(true);
  const accepted = await verifier.auth.signInWithPassword({ email, password: replacement });
  expect(Boolean(accepted.data.user)).toBe(true);
  await verifier.auth.signOut({ scope: 'local' });
  await page.goto(link!);
  await expect(page).toHaveURL('/auth/reset-password?error=invalid_link');
  await expect(page.getByLabel(/^新しいパスワード[\s*]*$/)).toHaveCount(0);
});

test('未登録メールでも同じ完了文言と再送待機を表示する @mobile', async ({ page }) => {
  const { randomUUID } = await import('node:crypto');
  await page.goto('/auth/forgot-password');
  await page.getByLabel('メールアドレス').fill(`unregistered-${randomUUID()}@example.com`);
  await page.getByRole('button', { name: '再設定用メールを送信' }).click();
  await expect(page.getByText(/登録されているメールアドレスの場合/)).toBeVisible();
  await expect(page.getByRole('button', { name: /秒後に再送できます/ })).toBeDisabled();
});
