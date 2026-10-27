// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), confirm: vi.fn(), toast: vi.fn() }));
vi.mock('@/app/actions/mcpControl', () => ({ getMcpImportControl: mocks.get, setMcpImportControl: mocks.set }));
vi.mock('@/components/ui/ConfirmProvider', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
import { McpImportSettings } from './McpImportSettings';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ ok: true, data: { enabled: false, conditions: null, confirmed_at: null } });
  mocks.set.mockResolvedValue({ ok: true, data: { enabled: true } });
  mocks.confirm.mockResolvedValue(true);
});
describe('MCP settings confirmation', () => {
  it('requires all conditions and a confirmation before enabling', async () => {
    render(<McpImportSettings organizationId="org" />);
    fireEvent.click(await screen.findByRole('button', { name: '確認して有効化' }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    for (const label of ['AI提供先', 'データ処理条件', '保存地域', '保存期間・ログ保持', '二次利用', '利用者への説明']) {
      fireEvent.change(screen.getByLabelText(`${label}の確認結果・根拠`), { target: { value: '確認済み' } });
    }
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '確認して有効化' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.set).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '確認して有効化' }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('org', true, expect.objectContaining({ region: '確認済み' }), true));
    expect(await screen.findByText(/事業所の設定: 有効/)).toBeTruthy();
  });
  it('does not offer a control when the status cannot be read', async () => {
    mocks.get.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: '拒否' } });
    render(<McpImportSettings organizationId="org" />);
    expect(await screen.findByText(/設定を取得できませんでした/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '確認して有効化' })).toBeNull();
  });
  it('clears the previous organization while the next status is loading', async () => {
    mocks.get.mockResolvedValueOnce({ ok: true, data: { enabled: true, conditions: { provider: 'previous', processing: 'a', region: 'b', retention: 'c', secondary_use: 'd', notice: 'e' }, confirmed_at: null } });
    let resolveNext!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve; }));
    const view = render(<McpImportSettings organizationId="first" />);
    expect(await screen.findByDisplayValue('previous')).toBeTruthy();
    view.rerender(<McpImportSettings organizationId="second" />);
    expect(screen.queryByDisplayValue('previous')).toBeNull();
    expect(screen.queryByRole('button', { name: 'AI記録送信を停止' })).toBeNull();
    resolveNext({ ok: true, data: { enabled: false, conditions: null, confirmed_at: null } });
    expect(await screen.findByRole('button', { name: '確認して有効化' })).toBeTruthy();
    expect(screen.getByLabelText('AI提供先の確認結果・根拠')).toHaveProperty('value', '');
  });

});
