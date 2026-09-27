import { describe, expect, it } from 'vitest';
import { buildClarificationQuestions } from '../../../supabase/functions/_shared/clarify-candidate';

const completeMeta = {
  date: '2026-09-27', start_at: '09:00', end_at: '10:00',
  client_name: '利用者', helper_names: ['担当者'],
};

describe('MCP clarification questions', () => {
  it('offers source choices and free text for an unreadable field', () => {
    const questions = buildClarificationQuestions(
      { meta: completeMeta },
      ['清掃: 丸印・選択肢を確認してください'],
      [{ id: 'cleaning', label: '清掃', type: 'multicheckbox', options: '居室,浴室,台所' }],
    );
    expect(questions).toEqual([{
      field_id: 'cleaning', question: '「清掃」はどの内容ですか？',
      options: ['居室', '浴室', '台所', 'このまま送信'], allow_free_text: true,
    }]);
  });

  it('asks for missing or invalid header values without guessing a date', () => {
    const questions = buildClarificationQuestions(
      { meta: { ...completeMeta, date: '2026/09/27', helper_names: [] } },
      ['記録日をYYYY-MM-DD形式で確認してください'],
      [],
    );
    expect(questions.map((item) => item.field_id)).toEqual(['date', 'helper_names']);
    expect(questions[0].options).toContain('このまま送信');
    expect(questions[0].options).not.toContain('今日');
  });
});
