import OpenAI from 'openai';
import type { ResponseInputContent } from 'openai/resources/responses/responses';
import type { FormItem } from './extractPrompt';
import { OPENAI_MODEL_NAME } from './model';
import { buildOpenAIExtractionSchema } from './openaiSchema';

export type ExtractionFile = {
  name: string;
  mimeType: string;
  data: Buffer;
};

type OpenAIExtractionOptions = {
  systemPrompt: string;
  userPrompt: string;
  files: ExtractionFile[];
  formTemplate: FormItem[];
};

export function buildOpenAIInput(userPrompt: string, files: ExtractionFile[]): ResponseInputContent[] {
  const content: ResponseInputContent[] = [{ type: 'input_text', text: userPrompt }];
  for (const file of files) {
    const dataUrl = `data:${file.mimeType};base64,${file.data.toString('base64')}`;
    if (file.mimeType === 'application/pdf') {
      content.push({ type: 'input_file', filename: file.name, file_data: dataUrl, detail: 'high' });
    } else {
      content.push({ type: 'input_image', image_url: dataUrl, detail: 'high' });
    }
  }
  return content;
}

export async function generateOpenAIExtractionText({
  systemPrompt,
  userPrompt,
  files,
  formTemplate,
}: OpenAIExtractionOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OpenAI APIキーが設定されていません');

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: OPENAI_MODEL_NAME,
    instructions: systemPrompt,
    input: [{ role: 'user', content: buildOpenAIInput(userPrompt, files) }],
    text: {
      format: {
        type: 'json_schema',
        name: 'care_record_extraction',
        strict: true,
        schema: buildOpenAIExtractionSchema(formTemplate),
      },
    },
    store: false,
  });

  if (response.status !== 'completed' || !response.output_text) {
    throw new Error('AI の応答形式が不正でした');
  }
  return response.output_text;
}
