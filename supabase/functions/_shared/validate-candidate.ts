export type FormItem = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string;
  hasDetail?: boolean;
};

export function normalizeDate(value: string | null, warnings: string[]): string | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    warnings.push('記録日をYYYY-MM-DD形式で確認してください');
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    warnings.push('存在しない記録日のため、原本を確認してください');
    return null;
  }
  return value;
}

export function normalizeTime(value: string | null, label: string, warnings: string[]): string | null {
  if (value === null) return null;
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return value;
  warnings.push(`${label}をHH:MM形式で確認してください`);
  return null;
}

export function normalizeValues(
  raw: Record<string, unknown>,
  template: FormItem[],
  warnings: string[],
): Record<string, string | number | boolean | string[]> {
  const fields = new Map(template.filter((item) => item.type !== 'section').map((item) => [item.id, item]));
  const values: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    const detail = key.endsWith('_detail');
    const item = fields.get(detail ? key.slice(0, -7) : key);
    if (!item || (detail && !item.hasDetail)) {
      warnings.push(`${key}: フォームにない項目です`);
      continue;
    }
    if (detail || item.type === 'text') {
      if (typeof value === 'string' && value.length <= 2000) values[key] = value;
      else warnings.push(`${item.label}: 手書き文字を確認してください`);
      continue;
    }
    if (item.type === 'checkbox') {
      if (typeof value === 'boolean') values[key] = value;
      else warnings.push(`${item.label}: チェック状態を確認してください`);
      continue;
    }
    if (item.type === 'multicheckbox') {
      const options = (item.options ?? '').split(',').map((option) => option.trim());
      if (Array.isArray(value) && value.length <= options.length && value.every((entry) => typeof entry === 'string' && options.includes(entry))) {
        values[key] = [...new Set(value)];
      } else warnings.push(`${item.label}: 丸印・選択肢を確認してください`);
      continue;
    }
    if (item.type === 'select') {
      const options = (item.options ?? '').split(',').map((option) => option.trim());
      if (typeof value === 'string' && options.includes(value)) values[key] = value;
      else warnings.push(`${item.label}: 選択肢を確認してください`);
      continue;
    }
    if (item.type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000) values[key] = value;
      else warnings.push(`${item.label}: 数値を確認してください`);
      continue;
    }
    if (item.type === 'time') {
      if (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) values[key] = value;
      else warnings.push(`${item.label}: 時刻を確認してください`);
    }
  }
  return values;
}
