import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { clickMenu, generateUser, registerClient, registerStaff, setupNewOrg } from './helpers';

test('通常・内勤・AI承認の保存結果が重複なく本人の履歴へ反映される', async ({ page }) => {
  test.slow();
  const user = generateUser();
  await setupNewOrg(page, user);
  await registerStaff(page, user.name, user.email);
  await registerClient(page, 'Feed利用者');
  const today = new Date().toISOString().slice(0, 10);

  await page.goto('/app/internal-work');
  await page.getByRole('button', { name: '内勤を記録', exact: true }).click();
  const internal = page.getByRole('dialog', { name: '内勤を記録', exact: true });
  await internal.getByLabel('件名').fill('Feed内勤会議');
  await internal.getByLabel('開始日時').fill(`${today}T10:00`);
  await internal.getByLabel('終了日時').fill(`${today}T11:00`);
  await internal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(internal).toBeHidden();
  await expect(page.getByText('Feed内勤会議', { exact: true })).toHaveCount(1);

  await clickMenu(page, '記録を作成');
  await page.getByText('Feed利用者 様', { exact: true }).click();
  await page.locator('input[type="datetime-local"]').nth(0).fill(`${today}T09:00`);
  await page.locator('input[type="datetime-local"]').nth(1).fill(`${today}T10:00`);
  await page.getByLabel('サービス提供').fill('1');
  await page.getByLabel('移動', { exact: true }).fill('0.5');
  await page.getByLabel('精算額').fill('0');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '送信する', exact: true }).click();
  await expect(page.getByText('記録を送信しました')).toBeVisible();
  await page.goto('/app/history');
  await expect(page.locator('[data-record-key^="report:"]')).toHaveCount(1);
  await expect(page.locator('[data-record-key^="internal:"]')).toHaveCount(1);

  // Seed a received AI result only in the runner's disposable local database.
  // No external AI service or hosted credentials are used.
  expect(process.env.E2E_TEST_ENV).toBe('true');
  expect(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname).toBe('127.0.0.1');
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: organization, error: orgError } = await admin.from('organizations').select('id').eq('name', user.orgName).single();
  expect(orgError).toBeNull();
  const { data: staff, error: staffError } = await admin.from('staffs').select('id, user_id').eq('organization_id', organization!.id).eq('name', user.name).single();
  expect(staffError).toBeNull();
  const { data: candidate, error: insertError } = await admin.from('ai_import_candidates').insert({ organization_id: organization!.id, created_by: staff!.user_id, source_file_name: 'feed-test.pdf', payload: { meta: { date: today, start_at: '11:00', end_at: '12:00', client_name: 'Feed利用者', helper_names: [user.name], client_id_candidate: null, helper_id_candidates: [], travel_time_hours: 0.5 }, values: {}, confidence: 'high', warnings: [] } }).select('id').single();
  expect(insertError).toBeNull();
  const candidateCard = page.locator(`[data-record-key="ai_submission:${candidate!.id}"]`);
  await expect(candidateCard).toBeVisible({ timeout: 45000 });
  await expect(page.locator('[data-record-key]')).toHaveCount(3);
  expect(await page.locator('[data-record-key]').first().getAttribute('data-record-key')).toBe(`ai_submission:${candidate!.id}`);

  await page.goto('/app/ai-candidates');
  await page.getByRole('button', { name: '内容を確認・修正', exact: true }).first().click();
  const review = page.getByRole('dialog', { name: '提供記録の確認・修正' });
  await review.getByRole('combobox', { name: '交通手段' }).click();
  await page.getByRole('option', { name: '交通費なし', exact: true }).click();
  await review.getByRole('button', { name: '内容を確認して承認', exact: true }).click();
  await expect(review).toBeHidden();
  await expect(page.getByText('AI送信を確認し、提供記録を承認しました')).toBeVisible();

  await page.goto('/app/history');
  await expect(page.locator('[data-record-key^="report:"]')).toHaveCount(2);
  await expect(page.locator('[data-record-key^="internal:"]')).toHaveCount(1);
  await expect(page.locator('[data-record-key^="ai_submission:"]')).toHaveCount(0);
  const { data: provenance } = await admin.from('ai_import_provenance').select('report_id').eq('candidate_id', candidate!.id).single();
  const approved = page.locator(`[data-record-key="report:${provenance!.report_id}"]`);
  await expect(approved.getByText('承認済', { exact: true })).toBeVisible();
  expect(await page.locator('[data-record-key]').first().getAttribute('data-record-key')).toBe(`report:${provenance!.report_id}`);
  await page.getByLabel('日付絞り込み').fill('2000-01-01');
  await expect(page.locator('[data-record-key]')).toHaveCount(0);
  await page.getByLabel('日付絞り込み').fill('');
  await expect(page.locator('[data-record-key]')).toHaveCount(3);
  await approved.getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`reportId=${provenance!.report_id}`));
});
