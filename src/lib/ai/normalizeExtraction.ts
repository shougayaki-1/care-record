import type { FormItem, PromptCandidate } from './extractPrompt';
import type { ExtractionResult, RawExtractionResult } from './extractSchema';
import { matchCandidateName } from './matchCandidate';

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Keep only values that fit the form used for this extraction. Never invent defaults. */
export function normalizeExtraction(
  raw: RawExtractionResult,
  template: FormItem[],
  clients: PromptCandidate[],
  helpers: PromptCandidate[],
): ExtractionResult {
  const fields = new Map(template.filter((item) => item.type !== 'section').map((item) => [item.id, item]));
  const values: ExtractionResult['values'] = {};
  const warnings = [...raw.warnings];

  for (const [key, value] of Object.entries(raw.values)) {
    const isDetail = key.endsWith('_detail');
    const item = fields.get(isDetail ? key.slice(0, -7) : key);
    if (!item || (isDetail && !item.hasDetail)) {
      warnings.push(`${key}: 現在のフォームにない項目です`);
      continue;
    }
    if (value === null || value === undefined) continue;
    if (value === '') {
      warnings.push(`${item.label}: 値が不明または空欄のため確認してください`);
      continue;
    }
    if (isDetail) {
      if (typeof value === 'string') values[key] = value;
      else warnings.push(`${item.label}の詳細: 文字列として読み取れませんでした`);
      continue;
    }

    const options = (item.options ?? '').split(',').map((option) => option.trim()).filter(Boolean);
    switch (item.type) {
      case 'checkbox':
        if (typeof value === 'boolean') values[key] = value;
        else warnings.push(`${item.label}: チェック状態を確認してください`);
        break;
      case 'multicheckbox':
        if (Array.isArray(value) && value.every((entry) => typeof entry === 'string' && options.includes(entry))) {
          values[key] = value;
        } else warnings.push(`${item.label}: 選択肢を確認してください`);
        break;
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) values[key] = value;
        else warnings.push(`${item.label}: 数値を確認してください`);
        break;
      case 'time':
        if (typeof value === 'string' && timePattern.test(value)) values[key] = value;
        else warnings.push(`${item.label}: 時刻を確認してください`);
        break;
      case 'select':
        if (typeof value === 'string' && options.includes(value)) values[key] = value;
        else warnings.push(`${item.label}: 選択肢を確認してください`);
        break;
      case 'text':
        if (typeof value === 'string') values[key] = value;
        else warnings.push(`${item.label}: 文字を確認してください`);
        break;
    }
  }

  for (const item of fields.values()) {
    if (item.required && !(item.id in values)) warnings.push(`${item.label}: 必須項目を確認してください`);
  }
  if (fields.size > 0 && Object.keys(values).length === 0) {
    warnings.push('フォーム項目を1件も抽出できませんでした');
  }

  const clientId = raw.meta.client_id_candidate;
  const helperIds = raw.meta.helper_id_candidates;
  const matchedClientId = raw.meta.client_name
    ? matchCandidateName(raw.meta.client_name, clients)?.id ?? null
    : null;
  const matchedHelperIds = new Set(raw.meta.helper_names
    .map((name) => matchCandidateName(name, helpers)?.id)
    .filter((id): id is string => Boolean(id)));
  if (clientId && clientId !== matchedClientId) {
    warnings.push('利用者候補を確認してください');
  }
  if (helperIds.some((id) => !matchedHelperIds.has(id))) {
    warnings.push('スタッフ候補を確認してください');
  }

  return {
    ...raw,
    meta: {
      ...raw.meta,
      client_id_candidate: clientId && clientId === matchedClientId ? clientId : null,
      helper_id_candidates: helperIds.filter((id) => matchedHelperIds.has(id)),
    },
    values,
    confidence: Object.keys(values).length === 0 && fields.size > 0
      ? 'low'
      : warnings.length > 0 && raw.confidence === 'high' ? 'medium' : raw.confidence,
    warnings: [...new Set(warnings)],
  };
}
