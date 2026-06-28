// src/constants/formTemplates.ts

export type FormItem = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'section' | 'multicheckbox';
  options?: string;
  required: boolean;
  hasDetail?: boolean;
  [key: string]: unknown; // 柔軟なプロパティ拡張に対応可能にする
};

export const DEFAULT_TEMPLATE: FormItem[] = [
  { id: 'sec_medical', label: '【医療的ケア・身体介護】', type: 'section', required: false },
  { id: 'sputum_suction', label: '痰等の吸引（気管・口腔）', type: 'checkbox', required: false },
  { id: 'sputum_cleaning', label: '痰等の吸引に関わる物品の清掃等', type: 'checkbox', required: false },
  { id: 'meal_help', label: '食事介助', type: 'multicheckbox', options: '朝,昼,晩,他', required: false, hasDetail: true },
  { id: 'water_supply', label: '水分補給', type: 'checkbox', required: false },
  { id: 'medication', label: '服薬介助', type: 'checkbox', required: false },
  { id: 'excretion', label: '排泄介助', type: 'checkbox', required: false, hasDetail: true },
  { id: 'urine_disposal', label: '排尿：尿破棄 (ml)', type: 'number', required: false },
  { id: 'oral_care', label: '口腔ケア', type: 'checkbox', required: false },
  { id: 'body_cleaning', label: '清拭・整容介助', type: 'multicheckbox', options: '全身,顔,上肢,下肢,手,足,背,陰部,頭部,臀部,整髪,耳掃除,爪切り,髭剃り,その他', required: false, hasDetail: true },
  { id: 'partial_bath', label: '部分浴', type: 'multicheckbox', options: '手,足,洗髪,陰部洗浄', required: false },
  { id: 'medical_app', label: '処置（シップ・薬・座薬・点眼）', type: 'multicheckbox', options: 'シップ貼付,薬塗布,座薬挿入,点眼', required: false },
  { id: 'change_clothes', label: '更衣介助', type: 'checkbox', required: false, hasDetail: true },
  { id: 'observation', label: '観察', type: 'multicheckbox', options: 'モニター,皮膚,体位置,表情,他', required: false, hasDetail: true },
  { id: 'vital_check', label: 'バイタル測定（実施項目）', type: 'multicheckbox', options: '体温,血圧,脈拍,SpO2,他', required: false, hasDetail: true },
  { id: 'temp_adjust', label: '温度調整', type: 'multicheckbox', options: '体温,室温', required: false },
  { id: 'sec_support', label: '【生活援助・移動支援】', type: 'section', required: false },
  { id: 'position_change', label: '体位・安楽', type: 'multicheckbox', options: '体位交換,良肢位,疼痛緩和,褥瘡予防', required: false },
  { id: 'env_maintenance', label: '環境整備', type: 'checkbox', required: false },
  { id: 'daily_assist_group', label: '日常の補佐', type: 'multicheckbox', options: 'コミュニケーション支援,各関節・筋肉の運動の補助,パソコン等の操作・設定,電話等の補助,書類の整理,家電等の設定・操作,他', required: false, hasDetail: true },
  { id: 'bedding_change', label: '寝具交換', type: 'checkbox', required: false, hasDetail: true },
  { id: 'transfer_assist', label: '移乗介助', type: 'checkbox', required: false },
  { id: 'move_assist', label: '移動介助（手押し車いす）', type: 'checkbox', required: false },
  { id: 'outing_assist', label: '外出介助', type: 'checkbox', required: false },
  { id: 'outing_prep', label: '外出に関する必要物品の用意・後片付', type: 'checkbox', required: false },
  { id: 'sec_housework', label: '【家事・その他】', type: 'section', required: false },
  { id: 'cooking', label: '調理・配膳', type: 'multicheckbox', options: '調理,配膳,下膳,後片付け', required: false },
  { id: 'cleaning', label: '掃除等・ゴミ出し', type: 'multicheckbox', options: '玄関,居間,寝室,台所,廊下,トイレ,浴室,洗面所,物品庫,掃除機,拭き掃除,他', required: false, hasDetail: true },
  { id: 'clothes_mending', label: '衣類の整理・補修', type: 'multicheckbox', options: '衣類の整理,被服の補修', required: false },
  { id: 'proxy_service', label: '代行業務', type: 'multicheckbox', options: '買物,銀行,郵便局,薬受け取り,他', required: false, hasDetail: true },
  { id: 'goods_organize', label: '物品整理', type: 'multicheckbox', options: '医薬品,衣料品,食料品,他', required: false, hasDetail: true },
  { id: 'laundry', label: '洗濯', type: 'multicheckbox', options: '干す,収納', required: false },
  { id: 'consultation', label: '相談援助', type: 'multicheckbox', options: '相談援助,情報収集,提供', required: false },
  { id: 'watching', label: '見守り', type: 'checkbox', required: false },
  { id: 'other_note', label: 'その他', type: 'text', required: false },
  { id: 'hospital_comm', label: '入院時コミュニケーション支援', type: 'checkbox', required: false },
  { id: 'sec_confirm', label: '【確認事項】', type: 'section', required: false },
  { id: 'benefit_change', label: '●給付変更事項', type: 'multicheckbox', options: '時間延長,時間短縮,追加訪問,時間変更', required: false },
  { id: 'exit_check', label: '●退出時確認事項', type: 'multicheckbox', options: '鍵,火元,電気,水道,戸締まり,ガス元栓,ボイラー', required: false },
  { id: 'special_note', label: '《特記事項》', type: 'text', required: false },
];

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
