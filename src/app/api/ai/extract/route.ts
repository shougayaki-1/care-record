import { NextRequest } from 'next/server';
import type { Part } from '@google-cloud/vertexai';
import { getAuthedUser, assertOrgRole } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { getGenerativeModel } from '@/lib/ai/gemini';
import { MODEL_NAME } from '@/lib/ai/model';
import { buildExtractionPrompt } from '@/lib/ai/extractPrompt';
import { ExtractionResponseSchema, ExtractionResponseVertexSchema } from '@/lib/ai/extractSchema';
import { sanitizeUploadedImage } from '@/utils/uploadSecurity';
import type { FormItem, PromptCandidate } from '@/lib/ai/extractPrompt';
import { formatSseEvent } from './sseUtils';
import { buildProcessingGroups, validateFileCount, validateFile } from './validation';
import { isAiImportEnabled } from '@/lib/env/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  // Feature flag is checked before authentication, body parsing, or Vertex client creation.
  if (!isAiImportEnabled()) {
    return new Response('Not Found', { status: 404 });
  }

  // 1. 組織境界チェック（認証 + 所属確認）— FormData解析前に実施してDoSを防ぐ
  // organizationId はURLパラメータで受け取る（body解析前にチェック可能にするため）
  const organizationId = request.nextUrl.searchParams.get('organizationId');
  if (!organizationId) {
    return new Response('Bad Request: organizationId is required', { status: 400 });
  }

  let authedUserId: string;
  let authedSessionId: string;
  try {
    const user = await getAuthedUser();
    authedUserId = user.id;
    authedSessionId = user.sessionId;
    await assertOrgRole(organizationId);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. FormData の取り出し（認証済み後）
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response('Bad Request: invalid form data', { status: 400 });
  }

  // 3. ファイル取得とファイル数の検証
  const files = formData.getAll('files[]') as File[];
  const countResult = validateFileCount(files.length);
  if (!countResult.ok) {
    return new Response(`Bad Request: ${countResult.reason}`, { status: 400 });
  }

  // 4. JSON フィールドのパース
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

  // 5. AI一括取込の開始を監査ログに記録
  try {
    await recordAuditEvent({
      organizationId,
      actorId: authedUserId,
      action: 'ai_import.started',
      resourceType: 'ai_import',
      sessionId: authedSessionId,
      outcome: 'success',
      details: { source: 'ai_import', model: MODEL_NAME, file_count: files.length },
    });
  } catch (auditErr) {
    // 監査ログの失敗はリクエストをブロックしない（ログだけ出す）
    console.error('[ai/extract] Failed to write audit log:', auditErr);
  }

  const groups = buildProcessingGroups(files.length, grouping);

  // 6. SSE ストリームを生成
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

      // 7. グループ単位でファイルを処理
      for (const group of groups) {
        // グループの代表 fileIndex (最初の要素)
        const fileIndex = group[0];

        try {
          // a. 各ファイルのバリデーション + ArrayBuffer 読み込み
          const parts: Part[] = [{ text: userPromptTemplate }];

          for (const idx of group) {
            const file = files[idx];
            if (!file) continue;

            // ファイルタイプ・サイズ検証
            const fileResult = validateFile(file);
            if (!fileResult.ok) {
              throw new Error(fileResult.reason);
            }

            const isImage = file.type.startsWith('image/');
            const fileBytes = isImage
              ? await sanitizeUploadedImage(file).then((sanitized) => ({
                  mimeType: sanitized.contentType,
                  data: sanitized.bytes,
                }))
              : {
                  mimeType: file.type,
                  data: Buffer.from(await file.arrayBuffer()),
                };

            parts.push({
              inlineData: {
                mimeType: fileBytes.mimeType,
                data: fileBytes.data.toString('base64'),
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
              responseSchema: ExtractionResponseVertexSchema,
            },
          });

          // c. レスポンスを取得してパース
          const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          let parsed: { records: unknown[] };
          try {
            parsed = JSON.parse(text) as { records: unknown[] };
          } catch {
            console.error(`[ai/extract] Gemini response was not valid JSON: ${text.slice(0, 200)}`);
            throw new Error('AI の応答形式が不正でした');
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
          const rawMessage = err instanceof Error ? err.message : String(err);
          console.error(`[ai/extract] Error processing file group [${group.join(',')}]: ${rawMessage}`);
          sendEvent('error', {
            type: 'error',
            fileIndex,
            message: toUserFacingErrorMessage(rawMessage),
          });
        } finally {
          sendEvent('group_done', {
            type: 'group_done',
            fileIndex,
          });
        }
      }

      // 8. 完了イベント
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

function toUserFacingErrorMessage(message: string): string {
  if (
    message.includes('対応していないファイル形式') ||
    message.includes('ファイルサイズ') ||
    message.includes('画像サイズ') ||
    message.includes('正常な画像') ||
    message.includes('安全でないファイル')
  ) {
    return message;
  }
  if (message.includes('AI の応答形式')) return message;
  return 'AIの読み取りに失敗しました。ファイルを確認して再度お試しください。';
}
