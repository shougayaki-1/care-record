// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ui/mui';
import theme from '@/theme';
import { ShiftSuggestions } from './ShiftSuggestions';
const mocks = vi.hoisted(() => ({ add: vi.fn(), linked: vi.fn(), suggestions: vi.fn() }));
vi.mock('@/app/actions/reportShifts', () => ({ addShiftLink: mocks.add, getLinkedShifts: mocks.linked, getShiftSuggestions: mocks.suggestions }));
vi.mock('@/components/auth/RecoveryLogoutButton', () => ({ RecoveryLogoutButton: () => <button>ログアウトしてやり直す</button> }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
it.each(['FORBIDDEN', 'SESSION_EXPIRED'])('retains a suggestion without refetching after %s and offers the appropriate recovery', async code => {
  mocks.add.mockResolvedValue({ ok: false, error: { code, message: '安全な紐付け拒否' } });
  const onLinked = vi.fn(); const onSuggestions = vi.fn(); const onError = vi.fn();
  render(<ThemeProvider theme={theme}><ShiftSuggestions organizationId="org" reportId="report"
    suggestions={[{ id: 'shift', title: '訪問', start_at: '2026-10-06T10:00:00Z', end_at: '2026-10-06T11:00:00Z', staffName: '担当' }]}
    linkedShifts={[]} dismissedSuggestions={new Set()} onDismiss={vi.fn()} onLinkedShiftsChange={onLinked} onSuggestionsChange={onSuggestions} onError={onError} /></ThemeProvider>);
  fireEvent.click(screen.getByRole('button', { name: '紐付ける' }));
  expect(await screen.findByText('安全な紐付け拒否')).toBeTruthy();
  expect(screen.getByRole('button', { name: '紐付ける' })).toBeTruthy();
  expect(!!screen.queryByRole('button', { name: 'ログアウトしてやり直す' })).toBe(code === 'SESSION_EXPIRED');
  expect(mocks.linked).not.toHaveBeenCalled(); expect(mocks.suggestions).not.toHaveBeenCalled();
  expect(onLinked).not.toHaveBeenCalled(); expect(onSuggestions).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith('安全な紐付け拒否');
});
