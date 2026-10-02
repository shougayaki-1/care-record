// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { ButtonHTMLAttributes } from 'react';

const mocks = vi.hoisted(() => ({
  callback: null as ((event: AuthChangeEvent, session: Session | null) => Promise<void>) | null,
  name: '', inviteCode: null as string | null,
  preview: vi.fn(), replace: vi.fn(), push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => ({ get: () => mocks.inviteCode }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { onAuthStateChange: (callback: typeof mocks.callback) => {
    mocks.callback = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  } },
  from: (table: string) => ({ select: () => ({ eq: () => table === 'profiles'
    ? { single: async () => ({ data: { name: mocks.name }, error: null }) }
    : Promise.resolve({ data: [] }),
  }) }),
} }));
vi.mock('@/app/actions/accounts', () => ({ acceptInvitation: vi.fn(), getInvitationPreview: mocks.preview }));
vi.mock('@/app/actions/user', () => ({ createOrganization: vi.fn(), updateOwnProfile: vi.fn() }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/components/ui', () => ({
  AppButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
}));

import SetupPage from './page';

beforeEach(() => {
  mocks.name = '';
  mocks.inviteCode = null;
  mocks.preview.mockReset().mockResolvedValue({ valid: false });
});
afterEach(cleanup);

async function loadUser(name = '') {
  mocks.name = name;
  await act(async () => {
    await mocks.callback!('INITIAL_SESSION', { user: { id: 'user-without-membership' } } as Session);
  });
}

function expectRecoveryForm() {
  const form = screen.getByRole('button', { name: '別のアカウントでログインする' }).closest('form');
  expect(form?.getAttribute('action')).toBe('/api/auth/recover');
  expect(form?.getAttribute('method')).toBe('post');
}

describe('setup recovery is always accessible', () => {
  it('初期ロード中にログアウトできる', () => {
    render(<SetupPage />);
    expect(screen.getByText('セットアップ情報を取得中...')).toBeTruthy();
    expectRecoveryForm();
  });

  it('プロフィール入力中にログアウトできる', async () => {
    render(<SetupPage />);
    await loadUser();
    expect(screen.getByText('ようこそ！')).toBeTruthy();
    expectRecoveryForm();
  });

  it.each(['choice', 'create', 'join'])('%s ステップにログアウトを表示する', async step => {
    render(<SetupPage />);
    await loadUser('利用者');
    if (step === 'create') fireEvent.click(screen.getByText('新しい事業所を作成する'));
    if (step === 'join') fireEvent.click(screen.getByText('既存の事業所に参加する'));
    expectRecoveryForm();
  });

  it('無効な招待コードでもログアウト導線を残す', async () => {
    mocks.inviteCode = 'expired-invite';
    render(<SetupPage />);
    await loadUser('利用者');
    expect(screen.getByText(/招待コードが無効または期限切れ/)).toBeTruthy();
    expectRecoveryForm();
  });
});
