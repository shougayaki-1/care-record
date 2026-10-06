// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from './AuthForm';

const mocks = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn() }));
vi.mock('@/app/actions/auth', () => ({ registerWithPassword: mocks.register, loginWithPassword: mocks.login }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOAuth: vi.fn() } } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('register=1&next=/setup') }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.register.mockResolvedValue({ ok: true, signedIn: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function form() {
  const view = render(<AuthForm />);
  fireEvent.change(screen.getByLabelText(/^メールアドレス/), { target: { value: 'synthetic@example.invalid' } });
  fireEvent.change(screen.getByLabelText(/^パスワード/), { target: { value: 'Synthetic!123' } });
  return view;
}
function navigationAfterDelay() {
  const location = { href: '' };
  const actualWindow = window;
  vi.stubGlobal('window', new Proxy(actualWindow, {
    get(target, key) { return key === 'location' ? location : Reflect.get(target, key, target); },
  }));
  try { act(() => { vi.advanceTimersByTime(1000); }); return location.href; }
  finally { vi.unstubAllGlobals(); }
}

describe('AuthForm registration navigation lifetime', () => {
  it('keeps the existing delayed navigation while the form is mounted', async () => {
    form();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'アカウントを作成' })); });
    expect(navigationAfterDelay()).toBe('/setup');
  });
  it('does not navigate back to setup after another route has unmounted the form', async () => {
    const view = form();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'アカウントを作成' })); });
    view.unmount();
    expect(navigationAfterDelay()).toBe('');
  });
  it('does not schedule navigation when the registration response arrives after unmount', async () => {
    let resolve!: (value: { ok: true; signedIn: true }) => void;
    mocks.register.mockReturnValue(new Promise(r => { resolve = r; }));
    const view = form();
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作成' }));
    view.unmount();
    await act(async () => { resolve({ ok: true, signedIn: true }); });
    expect(navigationAfterDelay()).toBe('');
  });
});
