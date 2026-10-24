// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewRow } from '@/components/ui/AiImportReviewTable';
import { useAiImportFiles } from './useAiImportFiles';
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: toast }) }));
const image = (name: string) => new File(['image'], name, { type: 'image/png' });
const revoke = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  let index = 0;
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:${++index}`), revokeObjectURL: revoke });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AI import files and preview ownership', () => {
  it('releases deleted previews, retains reviewed previews, and releases all remaining URLs on unmount in StrictMode', () => {
    const { result, rerender, unmount } = renderHook(({ rows }: { rows: ReviewRow[] }) => useAiImportFiles(rows, () => false), { initialProps: { rows: [] as ReviewRow[] }, wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> });
    act(() => result.current.addFiles([image('a.png'), image('b.png')]));
    const [a, b] = result.current.fileEntries;
    // Only the preview field is consumed by file ownership.
    rerender({ rows: [{ previewUrl: a.previewUrl } as ReviewRow] });
    act(() => { result.current.removeFile(a.id); result.current.removeFile(b.id); });
    expect(revoke.mock.calls).toEqual([[b.previewUrl]]);
    rerender({ rows: [] });
    expect(revoke.mock.calls).toEqual([[b.previewUrl], [a.previewUrl]]);
    act(() => result.current.addFiles([image('c.png')]));
    const c = result.current.fileEntries[0];
    unmount();
    expect(revoke.mock.calls).toEqual([[b.previewUrl], [a.previewUrl], [c.previewUrl]]);
  });
  it('clears file/group/selection state and defers URL release until review is cleared', () => {
    const { result, rerender } = renderHook(({ rows }: { rows: ReviewRow[] }) => useAiImportFiles(rows, () => false), { initialProps: { rows: [] as ReviewRow[] } });
    act(() => result.current.addFiles([image('a.png'), image('b.png')]));
    act(() => result.current.fileEntries.forEach((entry) => result.current.toggleSelectFile(entry.id)));
    act(() => result.current.mergeSelected());
    const previewUrl = result.current.fileEntries[0].previewUrl;
    rerender({ rows: [{ previewUrl } as ReviewRow] });
    act(() => result.current.clearFiles());
    expect(result.current.fileEntries).toEqual([]); expect(result.current.groups).toEqual([]); expect(result.current.selectedFileIds.size).toBe(0);
    expect(revoke).toHaveBeenCalledTimes(1);
    rerender({ rows: [] });
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it('regroups images, ungroups/removes files, rejects PDF grouping and ignores unsupported files', () => {
    const { result } = renderHook(() => useAiImportFiles([], () => false));
    act(() => result.current.addFiles([image('a.png'), image('b.png'), image('c.png'), new File(['pdf'], 'd.pdf', { type: 'application/pdf' }), new File(['gif'], 'e.gif', { type: 'image/gif' })]));
    expect(result.current.fileEntries).toHaveLength(4);
    const [a, b, c, pdf] = result.current.fileEntries;
    act(() => { result.current.toggleSelectFile(a.id); result.current.toggleSelectFile(b.id); });
    act(() => result.current.mergeSelected());
    act(() => { result.current.toggleSelectFile(b.id); result.current.toggleSelectFile(c.id); });
    act(() => result.current.mergeSelected());
    expect(result.current.groups.map((group) => group.fileIds)).toEqual([[a.id], [b.id, c.id]]);
    act(() => result.current.ungroupFile(b.id));
    expect(result.current.fileEntries.find((entry) => entry.id === b.id)?.groupId).toBeNull();
    act(() => result.current.removeFile(c.id));
    expect(result.current.groups.map((group) => group.fileIds)).toEqual([[a.id]]);
    act(() => { result.current.toggleSelectFile(a.id); result.current.toggleSelectFile(pdf.id); });
    act(() => result.current.mergeSelected());
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('PDFは単独'), 'warning');
  });
  it('uses the shared synchronous operation guard for all file edits', () => {
    let busy = false;
    const { result } = renderHook(() => useAiImportFiles([], () => busy));
    act(() => result.current.addFiles([image('a.png'), image('b.png')]));
    const entries = result.current.fileEntries;
    busy = true;
    act(() => {
      result.current.addFiles([image('c.png')]); result.current.removeFile(entries[0].id);
      result.current.toggleSelectFile(entries[0].id); result.current.mergeSelected(); result.current.ungroupFile(entries[0].id); result.current.clearFiles();
    });
    expect(result.current.fileEntries).toEqual(entries); expect(result.current.selectedFileIds.size).toBe(0); expect(revoke).not.toHaveBeenCalled();
  });
});
