import type { FormItem } from './extractPrompt';

type JsonSchema = Record<string, unknown>;

const nullable = (type: 'string' | 'number' | 'boolean' | 'array', description: string): JsonSchema => ({
  type: [type, 'null'],
  description,
});

/** OpenAI Structured Outputs requires every property and forbids extra object keys. */
export function buildOpenAIExtractionSchema(template: FormItem[]): JsonSchema {
  const valueProperties: Record<string, JsonSchema> = {};

  for (const item of template) {
    if (item.type === 'section') continue;
    const options = (item.options ?? '').split(',').map((option) => option.trim()).filter(Boolean);
    const description = `紙面の「${item.label}」。確認できなければ null`;

    switch (item.type) {
      case 'checkbox':
        valueProperties[item.id] = nullable('boolean', description);
        break;
      case 'multicheckbox':
        valueProperties[item.id] = {
          ...nullable('array', description),
          items: { type: 'string', ...(options.length ? { enum: options } : {}) },
        };
        break;
      case 'number':
        valueProperties[item.id] = nullable('number', description);
        break;
      case 'select':
        valueProperties[item.id] = {
          ...nullable('string', description),
          ...(options.length ? { enum: [...options, null] } : {}),
        };
        break;
      case 'time':
      case 'text':
        valueProperties[item.id] = nullable('string', description);
        break;
    }

    if (item.hasDetail) {
      valueProperties[`${item.id}_detail`] = nullable('string', `${item.label}の手書き詳細。なければ null`);
    }
  }

  const metaProperties: Record<string, JsonSchema> = {
    date: nullable('string', '記録日。YYYY-MM-DD形式。不明なら null'),
    start_at: nullable('string', '開始時刻。HH:MM形式。不明なら null'),
    end_at: nullable('string', '終了時刻。HH:MM形式。不明なら null'),
    client_name: nullable('string', '紙面で読み取った利用者名。不明なら null'),
    helper_names: { type: 'array', items: { type: 'string' } },
    client_id_candidate: nullable('string', '一意に一致した利用者候補ID。不明なら null'),
    helper_id_candidates: { type: 'array', items: { type: 'string' } },
    travel_time_hours: nullable('number', '紙面の移動(加算)時間。単位は時間。不明なら null'),
  };

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      records: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            meta: {
              type: 'object',
              additionalProperties: false,
              properties: metaProperties,
              required: Object.keys(metaProperties),
            },
            values: {
              type: 'object',
              additionalProperties: false,
              properties: valueProperties,
              required: Object.keys(valueProperties),
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            warnings: { type: 'array', items: { type: 'string' } },
          },
          required: ['meta', 'values', 'confidence', 'warnings'],
        },
      },
    },
    required: ['records'],
  };
}
