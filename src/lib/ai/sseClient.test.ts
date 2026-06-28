import { describe, expect, it } from 'vitest';
import { readAiExtractSse, type AiExtractSseEvent } from './sseClient';

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('readAiExtractSse', () => {
  it('event と data が別チャンクでも record イベントを読める', async () => {
    const events: AiExtractSseEvent[] = [];
    const record = {
      type: 'record',
      index: 0,
      fileIndex: 1,
      result: {
        meta: {
          date: '2026-06-28',
          start_at: '09:00',
          end_at: '10:00',
          client_name: '利用者',
          helper_names: ['スタッフ'],
          client_id_candidate: 'client-1',
          helper_id_candidates: ['helper-1'],
        },
        values: {},
        confidence: 'high',
        warnings: [],
      },
    };

    await readAiExtractSse(
      makeStream(['event: record\n', `data: ${JSON.stringify(record)}\n`, '\n']),
      (event) => {
        events.push(event);
      },
    );

    expect(events).toEqual([record]);
  });

  it('group_done イベントを読める', async () => {
    const events: AiExtractSseEvent[] = [];
    await readAiExtractSse(
      makeStream(['event: group_done\ndata: {"type":"group_done","fileIndex":2}\n\n']),
      (event) => {
        events.push(event);
      },
    );

    expect(events).toEqual([{ type: 'group_done', fileIndex: 2 }]);
  });
});
