import { describe, it, expect } from 'vitest';
import { formatSseEvent } from './sseUtils';

describe('formatSseEvent', () => {
  it('正しい SSE フォーマットの文字列を返す', () => {
    const result = formatSseEvent('record', { type: 'record', index: 0 });
    expect(result).toBe('event: record\ndata: {"type":"record","index":0}\n\n');
  });

  it('event 名が出力に含まれる', () => {
    const result = formatSseEvent('done', { type: 'done', total: 3 });
    expect(result).toContain('event: done');
  });

  it('data が JSON シリアライズされている', () => {
    const data = { type: 'error', fileIndex: 1, message: '読み取りエラー' };
    const result = formatSseEvent('error', data);
    expect(result).toContain(`data: ${JSON.stringify(data)}`);
  });

  it('イベントの末尾が "\\n\\n" で終わる', () => {
    const result = formatSseEvent('record', { type: 'record', index: 0, fileIndex: 0, result: {} });
    expect(result.endsWith('\n\n')).toBe(true);
  });

  it('空オブジェクトでも正常に出力できる', () => {
    const result = formatSseEvent('done', {});
    expect(result).toBe('event: done\ndata: {}\n\n');
  });

  it('ネストされたオブジェクトを正しくシリアライズする', () => {
    const data = {
      type: 'record',
      index: 0,
      fileIndex: 0,
      result: {
        meta: {
          date: '2026-06-28',
          start_at: '09:00',
          end_at: '11:00',
          client_name: '山田太郎',
          helper_names: [],
          client_id_candidate: null,
          helper_id_candidates: [],
        },
        values: {},
        confidence: 'high',
        warnings: [],
      },
    };
    const result = formatSseEvent('record', data);
    expect(result).toBe(`event: record\ndata: ${JSON.stringify(data)}\n\n`);
  });

  it('record イベントの SSE 行構造が正しい', () => {
    const result = formatSseEvent('record', { type: 'record', index: 2, fileIndex: 1, result: {} });
    const lines = result.split('\n');
    // event: record
    expect(lines[0]).toBe('event: record');
    // data: ...
    expect(lines[1]).toMatch(/^data: \{.*\}$/);
    // 空行2つ（末尾の \n\n により lines[2]="" lines[3]=""）
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('');
  });
});
