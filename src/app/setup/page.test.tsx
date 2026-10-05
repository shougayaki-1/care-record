// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { ButtonHTMLAttributes } from 'react';

const mocks = vi.hoisted(() => ({
  callback: null as ((event: AuthChangeEvent, session: Session | null) => void | Promise<void>) | null,
  name: '', inviteCode: null as string | null,
  preview: vi.fn(), replace: vi.fn(), push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
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

const router = { replace: mocks.replace, push: mocks.push };

import SetupPage from './page';

beforeEach(() => {
  mocks.name = '';
  mocks.inviteCode = null;
  mocks.preview.mockReset().mockResolvedValue({ valid: false });
});
afterEach(cleanup);

async function loadUser(name = '', { email }: { email?: string } = { email: 'user@example.com' }) {
  mocks.name = name;
  await act(async () => {
    mocks.callback!('INITIAL_SESSION', { user: { id: 'user-without-membership', email } } as Session);
    await new Promise(resolve => setTimeout(resolve, 0));
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
    expect(screen.queryByText(/現在ログイン中:/)).toBeNull();
    expectRecoveryForm();
  });

  it('セッション判明時に初期ロード中でもメールを表示する', () => {
    render(<SetupPage />);
    act(() => {
      mocks.callback!('INITIAL_SESSION', { user: { id: 'user-without-membership', email: 'user@example.com' } } as Session);
    });
    expect(screen.getByText('セットアップ情報を取得中...')).toBeTruthy();
    expect(screen.getByText('現在ログイン中: user@example.com')).toBeTruthy();
    expectRecoveryForm();
  });

  it('プロフィール入力中にログアウトできる', async () => {
    render(<SetupPage />);
    await loadUser();
    expect(screen.getByText('ようこそ！')).toBeTruthy();
    expect(screen.getByText('現在ログイン中: user@example.com')).toBeTruthy();
    expectRecoveryForm();
  });

  it.each(['choice', 'create', 'join'])('%s ステップにログアウトを表示する', async step => {
    render(<SetupPage />);
    await loadUser('利用者');
    if (step === 'create') fireEvent.click(screen.getByText('新しい事業所を作成する'));
    if (step === 'join') fireEvent.click(screen.getByText('既存の事業所に参加する'));
    expect(screen.getByText('現在ログイン中: user@example.com')).toBeTruthy();
    expectRecoveryForm();
  });

  it('無効な招待コードでもログアウト導線を残す', async () => {
    mocks.inviteCode = 'expired-invite';
    render(<SetupPage />);
    await loadUser('利用者');
    expect(screen.getByText(/招待コードが無効または期限切れ/)).toBeTruthy();
    expect(screen.getByText('現在ログイン中: user@example.com')).toBeTruthy();
    expectRecoveryForm();
  });

  it.each([undefined, ''])('メールが %s のときメール行を表示しない', async email => {
    render(<SetupPage />);
    await loadUser('', { email });
    expect(screen.queryByText(/現在ログイン中:/)).toBeNull();
    expectRecoveryForm();
  });

  it('セッションからメールがなくなると以前の表示を消す', async () => {
    render(<SetupPage />);
    await loadUser();
    act(() => {
      mocks.callback!('USER_UPDATED', { user: { id: 'user-without-membership' } } as Session);
    });
    expect(screen.queryByText(/現在ログイン中:/)).toBeNull();
    expectRecoveryForm();
  });

  it('ログアウト通知でメールを消して既存の遷移を維持する', async () => {
    render(<SetupPage />);
    await loadUser();
    act(() => { mocks.callback!('SIGNED_OUT', null); });
    expect(screen.queryByText(/現在ログイン中:/)).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });
});


describe('setup auth notifications preserve wizard progress', () => {
  it.each(['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'] as const)('does not reset the create step on %s', async event => {
    render(<SetupPage />);
    await loadUser('利用者');
    fireEvent.click(screen.getByText('新しい事業所を作成する'));
    fireEvent.change(screen.getByLabelText('事業所名'), { target: { value: '入力中の事業所' } });
    await act(async () => {
      mocks.callback!(event, { user: { id: 'user-without-membership', email: 'updated@example.com' } } as Session);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('button', { name: '作成して開始' })).toBeTruthy();
    expect((screen.getByLabelText('事業所名') as HTMLInputElement).value).toBe('入力中の事業所');
    expect(screen.getByText('現在ログイン中: updated@example.com')).toBeTruthy();
  });
});
