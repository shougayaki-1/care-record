// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/ui/mui';
import theme from '@/theme';
import { ActionResultError } from '@/utils/actionResult';
import { ShiftPatternModal } from './ShiftPatternModal';
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: toast }) }));
vi.mock('@/app/actions/serviceTypes', () => ({ getServiceTypes: async () => ({ ok: true, data: [] }) }));
vi.mock('@/app/actions/staffRoles', () => ({ getStaffRoles: async () => ({ ok: true, data: [] }) }));
vi.mock('@/components/auth/RecoveryLogoutButton', () => ({ RecoveryLogoutButton: () => <button>ログアウトしてやり直す</button> }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
it.each(['FORBIDDEN', 'SESSION_EXPIRED'])('keeps edited pattern input on %s and closes only after retry succeeds', async code => {
  const onClose = vi.fn();
  const onSave = vi.fn().mockRejectedValueOnce(new ActionResultError(code, '安全な保存拒否')).mockResolvedValue(undefined);
  render(<ThemeProvider theme={theme}><ShiftPatternModal open onClose={onClose} onSave={onSave} organizationId="org"
    clients={[{ id: 'client', name: '利用者' }]} staffs={[{ id: 'staff', name: '担当' }]}
    initialData={{ id: 'pattern', client_id: 'client', title: 'ひな形', start_time: '10:00', end_time: '12:00', rrule: 'FREQ=WEEKLY;BYDAY=MO', shift_pattern_staffs: [], shift_pattern_segments: [{ id: 'segment', service_type_id: null, start_time: '10:00', end_time: '12:00', sort_order: 0, shift_pattern_segment_staffs: [{ staff_id: 'staff', staff_role_id: null }] }] }} /></ThemeProvider>);
  await waitFor(() => expect(screen.getAllByDisplayValue('10:00')).toHaveLength(2));
  fireEvent.change(screen.getByLabelText('開始時間', { exact: false }), { target: { value: '09:30' } });
  fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));
  expect(await screen.findByText('安全な保存拒否')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('09:30')).toBeTruthy();
  expect(!!screen.queryByRole('button', { name: 'ログアウトしてやり直す' })).toBe(code === 'SESSION_EXPIRED');
  fireEvent.click(screen.getByRole('button', { name: '設定を保存' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenNthCalledWith(2, expect.objectContaining({ startTime: '09:30:00' }), 'pattern');
});
