import { describe, expect, it } from 'vitest';
import template from '../../../supabase/functions/_shared/default-form-template.json';
import {
  normalizeDate,
  normalizeTime,
  normalizeValues,
  type FormItem,
} from '../../../supabase/functions/_shared/validate-candidate';

describe('MCP候補の受け口', () => {
  it('フォーム外の値や不正な丸印・チェックを保存しない', () => {
    const warnings: string[] = [];
    const values = normalizeValues({
      sputum_suction: 'はい',
      meal_help: ['朝', '夜'],
      meal_help_detail: '少量介助',
      water_supply: true,
      unknown_item: '推測値',
    }, template as FormItem[], warnings);

    expect(values).toEqual({ meal_help_detail: '少量介助', water_supply: true });
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('チェック状態'),
      expect.stringContaining('丸印'),
      expect.stringContaining('フォームにない'),
    ]));
  });

  it('存在しない日付や時刻をnullにして確認を促す', () => {
    const warnings: string[] = [];
    expect(normalizeDate('2026-02-30', warnings)).toBeNull();
    expect(normalizeTime('25:00', '開始時刻', warnings)).toBeNull();
    expect(normalizeDate('2024-02-29', warnings)).toBe('2024-02-29');
    expect(warnings).toHaveLength(2);
  });
});
