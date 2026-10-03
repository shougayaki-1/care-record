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
 * AI取込プロバイダー共通のプロンプトを構築する。
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
        "date": "YYYY-MM-DD または null",
        "start_at": "HH:MM または null",
        "end_at": "HH:MM または null",
        "client_name": "読み取った利用者名。不明なら null",
        "helper_names": ["読み取ったスタッフ名1", "スタッフ名2"],
        "client_id_candidate": "候補リストから照合した利用者ID。不明なら null",
        "helper_id_candidates": ["候補リストから照合したスタッフID。不明なら空配列"],
        "travel_time_hours": null
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

1. 1枚のサービス提供記録票は1件の records 要素です。複数ページが1件の記録に属する場合も1件にまとめ、同じ記録を重複して出力しないでください。別の記録票が複数ある場合だけ複数要素にしてください。
2. values にはスキーマの全項目を含めてください。紙面で値が確認できない項目は null にし、読み取れない場合は warnings に理由を記載してください。推測で埋めないでください。
3. multicheckbox フィールドは、チェックされた項目のみを string[] で返してください。すべて未選択と明確に確認できた場合だけ []、判別不能なら null としてください。
4. checkbox フィールドは boolean（true/false）で返してください。false は未チェックを明確に確認できた場合だけ使用し、判別不能なら null にしてください。
5. number フィールドは紙面で読み取れた数値（number）のみ返してください。読めない数値を 0 に置き換えず null にしてください。
6. text/time フィールドは紙面で読み取れた文字列のみ返してください。読めない値を空文字列に置き換えず null にしてください。
7. section タイプのフィールドは values に含めないでください。
8. hasDetail フィールドは "{id}_detail" キーに詳細テキストを string で格納し、詳細がなければ null にしてください。
9. 利用者名とスタッフ名は紙面で読めた文字をそのまま返してください。候補に合わせて読めない文字を推測・補正しないでください。利用者名が判読できなければ null、スタッフ名が判読できなければ helper_names は [] にし、warnings に記載してください。
10. 利用者候補に明確かつ一意に一致する場合だけ client_id_candidate にその id を返してください。特定できない場合は null を返してください。
11. スタッフ候補に明確かつ一意に一致する場合だけ helper_id_candidates に該当する id を返してください。特定できない場合は [] を返してください。
12. confidence は全フィールドの読み取り品質を総合評価してください: high（ほぼ全て読み取れた）/ medium（大部分読み取れたが一部不明瞭）/ low（多数のフィールドが不明瞭または欠損）。この値は人による確認を省略する許可ではありません。
13. warnings には読み取れなかったフィールドや判断が難しかった箇所を日本語で記載してください。
14. 印刷された選択肢の文字や空の □ は選択済みを意味しません。手書きのチェックや丸印が明確に付いた項目だけを選択してください。見出し前の印刷された ● は選択マークとして扱わないでください。
15. 各行の左端の □ と、括弧内・行内の選択肢は別々に判定してください。左端の □ にチェックがあっても括弧内の全選択肢を選ばず、個別に丸やチェックが付いた選択肢だけを返してください。括弧内に何も丸がなければ [] とし、親のチェックだけがあることを warnings に記載してください。
16. 左端の □ を読む checkbox 項目は、その □ だけを見て true/false を決めてください。隣の行に伸びた手書きの斜線や印刷された ● との混同に注意してください。判定が難しければ null と warnings にしてください。
17. 和暦の記録日は、紙面の元号と年を確認してから西暦に変換してください。令和N年は 2018 + N 年（令和8年は2026年）、平成N年は 1988 + N 年です。年・月・日が判読できない場合は推測せず warnings に記載してください。
18. 紙面の「移動(加算)」欄は travel_time_hours に時間単位の数値で返してください。空欄または判読不能なら null とし、開始・終了時刻から推測しないでください。
19. 《特記事項》などの手書きテキストは、その欄に実際に書かれた文字だけを転記してください。近くの印刷済み項目や別の欄の文字で補完しないでください。判読できない場合は null とし、warnings に記載してください。
20. 横に並ぶ選択肢は先頭から末尾まで一つずつ丸印を確認してください。丸印が隣り合う場合でも、各選択肢を独立に判定してください。

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
