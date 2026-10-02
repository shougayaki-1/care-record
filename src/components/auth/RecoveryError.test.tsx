// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorPage from '@/app/error';
import GlobalError from '@/app/global-error';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('provider-independent error recovery', () => {
  it.each([
    ['Loading chunk 123 failed - private-care-data', 'chunk'],
    ['Hydration failed - private-care-data', 'hydration'],
    ['Runtime error - private-care-data', 'runtime'],
  ])('エラーを安全な分類で記録し、再試行と native POST を提供する (%s)', (message, kind) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retry = vi.fn();
    render(<ErrorPage error={Object.assign(new Error(message), { digest: '123' })} retry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    const form = screen.getByRole('button', { name: 'ログアウトしてやり直す' }).closest('form')!;
    expect(form.action).toContain('/api/auth/recover');
    expect(fireEvent.submit(form)).toBe(true); // No preventDefault or Supabase import.
    expect(screen.queryByText(/private-care-data/)).toBeNull();
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ boundary: 'segment', kind, digest: '123' }));
  });

  it('global-error は Provider なしで独自の html/body を描画する', () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error('root failed')} retry={vi.fn()} />);
    expect(html).toContain('<html lang="ja"><head></head><body>');
    expect(html).toContain('画面を表示できませんでした');
    expect(html).toContain('action="/api/auth/recover"');
    expect(html).toContain('method="post"');
  });
});
