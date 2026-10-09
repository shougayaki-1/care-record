// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ agree: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app' }));
vi.mock('@/app/actions/user', () => ({ acceptCurrentTerms: mocks.agree }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_agreed: false } }) }) }) }),
} }));
import { TermsAgreementModal } from './TermsAgreementModal';
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it.each(['FORBIDDEN', 'SESSION_EXPIRED'])('keeps agreement reviewable after %s and offers recovery only for expired session', async code => {
  mocks.agree.mockResolvedValue({ ok: false, error: { code, message: '安全な失敗文言' } });
  render(<TermsAgreementModal />);
  const checkbox = await screen.findByRole('checkbox');
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: '同意してサービスを利用する' }));
  expect((await screen.findByRole('alert')).textContent).toContain('安全な失敗文言');
  expect(screen.getByRole('dialog')).toBeTruthy();
  const recovery = screen.queryByRole('button', { name: 'ログアウトしてやり直す' });
  if (code === 'SESSION_EXPIRED') expect(recovery?.closest('form')?.getAttribute('method')).toBe('post');
  else expect(recovery).toBeNull();
});

it('does not expose rejected transport details', async () => {
  mocks.agree.mockRejectedValue(new Error('private server detail'));
  render(<TermsAgreementModal />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '同意してサービスを利用する' }));
  expect((await screen.findByRole('alert')).textContent).not.toContain('private server detail');
});
