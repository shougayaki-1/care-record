import { NextRequest } from 'next/server';
import type { Part } from '@google-cloud/vertexai';
import { getAuthedUser } from '@/utils/supabase/auth';
import { getGenerativeModel } from '@/lib/ai/gemini';
import { buildExtractionPrompt } from '@/lib/ai/extractPrompt';
import { ExtractionResponseSchema } from '@/lib/ai/extractSchema';
import type { FormItem, PromptCandidate } from '@/lib/ai/extractPrompt';
import { formatSseEvent } from './sseUtils';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  // 1. 認証チェック
  try {
    await getAuthedUser();
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. FormData の取り出し
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response('Bad Request: invalid form data', { status: 400 });
  }

  const files = formData.getAll('files[]') as File[];
  if (files.length === 0) {
    return new Response('Bad Request: no files provided', { status: 400 });
  }

  let clients: PromptCandidate[] = [];
  let helpers: PromptCandidate[] = [];
  let formTemplate: FormItem[] = [];
  let grouping: number[][] | null = null;

  try {
    const clientsRaw = formData.get('clients');
    if (clientsRaw) clients = JSON.parse(clientsRaw as string) as PromptCandidate[];

    const helpersRaw = formData.get('helpers');
    if (helpersRaw) helpers = JSON.parse(helpersRaw as string) as PromptCandidate[];

    const formTemplateRaw = formData.get('formTemplate');
    if (formTemplateRaw) formTemplate = JSON.parse(formTemplateRaw as string) as FormItem[];

    const groupingRaw = formData.get('grouping');
    if (groupingRaw) grouping = JSON.parse(groupingRaw as string) as number[][];
  } catch {
    return new Response('Bad Request: invalid JSON in form fields', { status: 400 });
  }

  // グループリストを構築する (grouping 未指定の場合は1ファイル1グループ)
  const groups: number[][] =
    grouping ?? files.map((_, i) => [i]);

  // 3. SSE ストリームを生成
  const { systemPrompt, userPromptTemplate } = buildExtractionPrompt({
    formTemplate,
    clients,
    helpers,
  });

  const model = getGenerativeModel();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: string, data: object) {
        controller.enqueue(encoder.encode(formatSseEvent(event, data)));
      }

      try {
      let recordIndex = 0;

      // 4. グループ単位でファイルを処理
      for (const group of groups) {
        // グループの代表 fileIndex (最初の要素)
        const fileIndex = group[0];

        try {
          // a. 各ファイルを ArrayBuffer に読み込む
          const parts: Part[] = [{ text: userPromptTemplate }];

          for (const idx of group) {
            const file = files[idx];
            if (!file) continue;
            const arrayBuffer = await file.arrayBuffer();
            parts.push({
              inlineData: {
                mimeType: file.type,
                data: Buffer.from(arrayBuffer).toString('base64'),
              },
            });
          }

          // b. Gemini に送信
          const result = await model.generateContent({
            contents: [
              {
                role: 'user',
                parts,
              },
            ],
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
            generationConfig: {
              responseMimeType: 'application/json',
            },
          });

          // c. レスポンスを取得してパース
          const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          let parsed: { records: unknown[] };
          try {
            parsed = JSON.parse(text) as { records: unknown[] };
          } catch {
            throw new Error(`Gemini のレスポンスが JSON として解析できませんでした: ${text.slice(0, 200)}`);
          }

          const validated = ExtractionResponseSchema.parse(parsed);

          // d. 各記録を record イベントとして送信
          for (const record of validated.records) {
            sendEvent('record', {
              type: 'record',
              index: recordIndex,
              fileIndex,
              result: record,
            });
            recordIndex++;
          }
        } catch (err) {
          // e. エラーは error イベントとして送信、処理を継続
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[ai/extract] Error processing file group [${group.join(',')}]: ${message}`);
          sendEvent('error', {
            type: 'error',
            fileIndex,
            message,
          });
        }
      }

      // 5. 完了イベント
      sendEvent('done', { type: 'done', total: recordIndex });
      controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
