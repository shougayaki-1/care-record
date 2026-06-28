import type { ExtractionResult } from './extractSchema';

export type AiExtractSseEvent =
  | { type: 'record'; index: number; fileIndex: number; result: ExtractionResult }
  | { type: 'error'; fileIndex: number; message: string }
  | { type: 'group_done'; fileIndex: number }
  | { type: 'done'; total: number };

export async function readAiExtractSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AiExtractSseEvent) => void | Promise<void>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentData = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        currentData += line.slice(5).trim();
      } else if (line === '') {
        if (currentEvent && currentData) {
          const parsed = JSON.parse(currentData) as AiExtractSseEvent;
          await onEvent(parsed);
        }
        currentEvent = '';
        currentData = '';
      }
    }
  }
}
