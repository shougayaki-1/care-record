type ClarificationField = { id: string; label: string; type: string; options?: string };
type ClarificationRecord = {
  meta: {
    date: string | null;
    start_at: string | null;
    end_at: string | null;
    client_name: string | null;
    helper_names: string[];
  };
};

export type ClarificationQuestion = {
  field_id: string;
  question: string;
  options: string[];
  allow_free_text: true;
};

/** Questions stay bounded so an unclear form can be sent without a long interview. */
export function buildClarificationQuestions(
  record: ClarificationRecord,
  warnings: string[],
  template: ClarificationField[],
): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  const add = (field_id: string, question: string, options: string[]) => {
    if (!questions.some((item) => item.field_id === field_id)) {
      questions.push({ field_id, question, options, allow_free_text: true });
    }
  };
  if (!record.meta.date || warnings.some((warning) => /記録日/.test(warning))) add('date', '記録日はいつですか？', ['原本を見て入力する', 'このまま送信']);
  if (!record.meta.start_at || warnings.some((warning) => /開始時刻/.test(warning))) add('start_at', '開始時刻は何時ですか？', ['原本を見て入力する', 'このまま送信']);
  if (!record.meta.end_at || warnings.some((warning) => /終了時刻/.test(warning))) add('end_at', '終了時刻は何時ですか？', ['原本を見て入力する', 'このまま送信']);
  if (!record.meta.client_name) add('client_name', '利用者名を教えてください。', ['原本を見て入力する', 'このまま送信']);
  if (record.meta.helper_names.length === 0) add('helper_names', '担当ヘルパー名を教えてください。', ['原本を見て入力する', 'このまま送信']);

  for (const warning of warnings) {
    const field = template.find((item) => item.type !== 'section' &&
      (warning.startsWith(`${item.id}:`) || warning.includes(item.label)));
    if (!field) continue;
    const options = (field.options ?? '').split(',').map((option) => option.trim()).filter(Boolean);
    add(field.id, `「${field.label}」はどの内容ですか？`, field.type === 'checkbox' ? ['あり', 'なし', 'このまま送信'] : [...options.slice(0, 6), 'このまま送信']);
    if (questions.length >= 5) break;
  }
  return questions.slice(0, 5);
}
