/** フォームフィールド定義の型（record ページの FormItem と同型） */
export type FormItem = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string;
  required: boolean;
  hasDetail?: boolean;
};

export type PromptCandidate = {
  id: string;
  name: string;
};

export type BuildPromptOptions = {
  formTemplate: FormItem[];
  clients: PromptCandidate[];
  helpers: PromptCandidate[];
};

export type BuiltPrompt = {
  systemPrompt: string;
  userPromptTemplate: string;
};

/**
 * フィールドタイプの日本語説明
 */
function describeType(item: FormItem): string {
  switch (item.type) {
    case 'section':
      return 'セクション見出し（値なし）';
    case 'checkbox':
      return 'チェックボックス（true / false）';
    case 'multicheckbox':
      return `複数選択チェックボックス（選択肢: ${item.options ?? ''}）→ 選択された項目を string[] で返す`;
    case 'number':
      return '数値入力（number）';
    case 'time':
      return '時刻入力（"HH:MM" 形式）';
    case 'select':
      return `選択肢（${item.options ?? ''}）`;
    case 'text':
      return 'テキスト入力（string）';
    default:
      return 'テキスト（string）';
  }
}

/**
 * Gemini へのプロンプトを構築する。
 *
 * @param options.formTemplate - フォームのフィールド定義（DEFAULT_TEMPLATE と同型）
 * @param options.clients      - 候補利用者リスト（名前照合用）
 * @param options.helpers      - 候補スタッフリスト（名前照合用）
 * @returns systemPrompt と userPromptTemplate
 */
export function buildExtractionPrompt({
  formTemplate,
  clients,
  helpers,
}: BuildPromptOptions): BuiltPrompt {
  // フィールド一覧（section 以外のみ値を抽出対象とする）
  const fieldLines = formTemplate
    .filter((item) => item.type !== 'section')
    .map((item) => {
      const detail = item.hasDetail ? '（詳細テキストあり: フィールドID "{id}_detail" に string で格納）'.replace('{id}', item.id) : '';
      return `  - id: "${item.id}"  ラベル: "${item.label}"  型: ${describeType(item)}${detail}`;
    })
    .join('\n');

  const clientList =
    clients.length > 0
      ? clients.map((c) => `  - "${c.name}" (id: ${c.id})`).join('\n')
      : '  （候補なし）';

  const helperList =
    helpers.length > 0
      ? helpers.map((h) => `  - "${h.name}" (id: ${h.id})`).join('\n')
      : '  （候補なし）';

  const systemPrompt = `あなたは介護記録のOCRデータ抽出AIです。
アップロードされた画像またはPDFスキャンから、介護サービス提供記録の内容を読み取り、
指定されたJSONスキーマに従って構造化データとして出力してください。

## 出力形式

必ず以下のJSON形式で出力してください（マークダウンのコードブロック不要、純粋なJSONのみ）:
{
  "records": [
    {
      "meta": {
        "date": "YYYY-MM-DD",
        "start_at": "HH:MM",
        "end_at": "HH:MM",
        "client_name": "読み取った利用者名",
        "helper_names": ["読み取ったスタッフ名1", "スタッフ名2"],
        "client_id_candidate": "候補リストから照合した利用者ID。不明なら null",
        "helper_id_candidates": ["候補リストから照合したスタッフID。不明なら空配列"]
      },
      "values": {
        "フィールドid": 値,
        ...
      },
      "confidence": "high" | "medium" | "low",
      "warnings": ["読み取れなかった・不明確だったフィールドの説明"]
    }
  ]
}

## 重要ルール

1. PDFや画像に複数の記録が含まれる場合は、records 配列に複数の要素を含めてください。
2. values オブジェクトには、チェックが入っていない（falseの）フィールドも含めてください。
3. multicheckbox フィールドは、チェックされた項目のみを string[] で返してください（未選択なら []）。
4. checkbox フィールドは boolean（true/false）で返してください。
5. number フィールドは数値（number）で返してください。読み取れない場合は 0 としてください。
6. text/time フィールドは string で返してください。読み取れない場合は "" としてください。
7. section タイプのフィールドは values に含めないでください。
8. hasDetail フィールドは "{id}_detail" キーに詳細テキストを string で格納してください。
9. 利用者名とスタッフ名は、候補リストと照合して最も近い名前に補正してください。
10. 候補リストから利用者を特定できる場合は client_id_candidate にその id を返してください。特定できない場合は null を返してください。
11. 候補リストからスタッフを特定できる場合は helper_id_candidates に該当する id を返してください。特定できない場合は [] を返してください。
12. confidence は全フィールドの読み取り品質を総合評価してください: high（ほぼ全て読み取れた）/ medium（大部分読み取れたが一部不明瞭）/ low（多数のフィールドが不明瞭または欠損）。
13. warnings には読み取れなかったフィールドや判断が難しかった箇所を日本語で記載してください。

## フォームフィールド定義

以下のフィールドを values に含めてください（section は除く）:

${fieldLines}

## 利用者候補リスト（名前照合用）

${clientList}

## スタッフ候補リスト（名前照合用）

${helperList}
`;

  const userPromptTemplate = `添付のファイルは介護サービス提供記録の手書きまたは印刷されたフォームです。
上記の指示に従い、記録内容を読み取ってJSONで出力してください。`;

  return { systemPrompt, userPromptTemplate };
}
