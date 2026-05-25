import { FormItem } from '@/types';

// 他コンポーネントからのインポート互換性を維持するために再エクスポート
export type { FormItem };

// 1. 身体介護中心テンプレート
export const PHYSICAL_CARE_TEMPLATE: FormItem[] = [
  { id: 'sec_medical', label: '【身体介護・医療的ケア】', type: 'section', required: false },
  { id: 'meal_help', label: '食事介助', type: 'multicheckbox', options: '全介助,一部介助,見守り,水分補給', required: false, hasDetail: true },
  { id: 'excretion', label: '排泄介助', type: 'multicheckbox', options: 'トイレ誘導,オムツ交換,パッド交換,ポータブルトイレ,陰部洗浄', required: false, hasDetail: true },
  { id: 'body_cleaning', label: '清拭・入浴', type: 'multicheckbox', options: '全身清拭,部分清拭,入浴介助,洗髪,足浴', required: false, hasDetail: true },
  { id: 'change_clothes', label: '更衣介助', type: 'checkbox', required: false, hasDetail: true },
  { id: 'medication', label: '服薬確認', type: 'checkbox', required: false },
  { id: 'vital_check', label: 'バイタル測定', type: 'multicheckbox', options: '体温,血圧,脈拍,SpO2', required: false, hasDetail: true },
  { id: 'sec_note', label: '【その他】', type: 'section', required: false },
  { id: 'special_note', label: '特記事項', type: 'text', required: false },
];

// 2. 生活援助中心テンプレート
export const HOUSEWORK_TEMPLATE: FormItem[] = [
  { id: 'sec_housework', label: '【生活援助】', type: 'section', required: false },
  { id: 'cooking', label: '調理', type: 'multicheckbox', options: '下ごしらえ,調理,配膳,後片付け', required: false, hasDetail: true },
  { id: 'cleaning', label: '掃除', type: 'multicheckbox', options: '居室,トイレ,浴室,台所,ゴミ出し', required: false, hasDetail: true },
  { id: 'laundry', label: '洗濯', type: 'multicheckbox', options: '洗濯機,干す,取り込み,たたむ,収納', required: false },
  { id: 'shopping', label: '買い物代行', type: 'checkbox', required: false, hasDetail: true },
  { id: 'sec_note', label: '【その他】', type: 'section', required: false },
  { id: 'special_note', label: '特記事項', type: 'text', required: false },
];

// 3. 総合テンプレート（重度訪問介護などフルの内容）
export const COMPREHENSIVE_TEMPLATE: FormItem[] = [
  { id: 'sec_medical', label: '【医療的ケア・身体介護】', type: 'section', required: false },
  { id: 'sputum_suction', label: '痰等の吸引（気管・口腔）', type: 'checkbox', required: false },
  { id: 'meal_help', label: '食事介助', type: 'multicheckbox', options: '朝,昼,晩,他', required: false, hasDetail: true },
  { id: 'excretion', label: '排泄介助', type: 'checkbox', required: false, hasDetail: true },
  { id: 'body_cleaning', label: '清拭・整容介助', type: 'multicheckbox', options: '全身,顔,上肢,下肢,清拭,入浴介助', required: false, hasDetail: true },
  { id: 'change_clothes', label: '更衣介助', type: 'checkbox', required: false, hasDetail: true },
  { id: 'vital_check', label: 'バイタル測定', type: 'multicheckbox', options: '体温,血圧,脈拍,SpO2', required: false, hasDetail: true },
  { id: 'sec_support', label: '【生活援助・移動支援】', type: 'section', required: false },
  { id: 'position_change', label: '体位交換', type: 'checkbox', required: false },
  { id: 'move_assist', label: '移動・移乗介助', type: 'checkbox', required: false },
  { id: 'sec_housework', label: '【家事】', type: 'section', required: false },
  { id: 'cooking', label: '調理・配膳', type: 'multicheckbox', options: '調理,配膳,下膳', required: false },
  { id: 'cleaning', label: '掃除・ゴミ出し', type: 'multicheckbox', options: '居室,水回り,ゴミ出し', required: false },
  { id: 'laundry', label: '洗濯', type: 'checkbox', required: false },
  { id: 'sec_confirm', label: '【確認事項】', type: 'section', required: false },
  { id: 'exit_check', label: '退出時確認（火元・戸締まり）', type: 'checkbox', required: false },
  { id: 'special_note', label: '《特記事項》', type: 'text', required: false },
];

// リストとしてエクスポート
export const STANDARD_TEMPLATES = [
  { key: 'comprehensive', name: '標準セット（重度訪問・総合）', schema: COMPREHENSIVE_TEMPLATE, description: '身体介護から生活援助まで網羅したフルセット' },
  { key: 'physical', name: '身体介護中心', schema: PHYSICAL_CARE_TEMPLATE, description: '入浴・排泄・食事などの身体ケアに特化' },
  { key: 'housework', name: '生活援助中心', schema: HOUSEWORK_TEMPLATE, description: '掃除・洗濯・調理などの家事援助に特化' },
];