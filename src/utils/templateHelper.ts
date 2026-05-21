// src/utils/templateHelper.ts

import { FormItem } from '@/constants/formTemplates';

// 他の画面ファイル（clients/[id]/page.tsx等）でのインポート互換性を維持するため、
// 集約先の型定義をここで安全に再エクスポートします。
export type { FormItem };

export type FormValue = string | number | boolean | string[] | null | undefined;

/**
 * フォームの設定(Schema)を元に、UUIDと日本語キーの対応マップを生成します
 */
export const generateKeyMap = (schema: FormItem[]) => {
    const idToLabelMap: Record<string, string> = {};
    const labelCount: Record<string, number> = {};

    schema.forEach(item => {
        // 記号（●、■、▼、《》、【】）を除去する正規表現を適用
        let cleanLabel = item.label.replace(/[{}[\].●■▼《》【】]/g, '').trim();

        if (!cleanLabel) cleanLabel = "項目";

        // 重複チェック（同じ名前の項目がある場合、_2, _3 を付与）
        if (labelCount[cleanLabel]) {
            labelCount[cleanLabel]++;
            const uniqueLabel = `${cleanLabel}_${labelCount[cleanLabel]}`;
            idToLabelMap[item.id] = uniqueLabel;
        } else {
            labelCount[cleanLabel] = 1;
            idToLabelMap[item.id] = cleanLabel;
        }
    });

    return idToLabelMap;
};

/**
 * GASに送信するために、スキーマのID部分を日本語キーに置換した新しいスキーマを作成します
 */
export const convertSchemaToReadable = (schema: FormItem[]) => {
    const keyMap = generateKeyMap(schema);
    return schema.map(item => ({
        ...item,
        id: keyMap[item.id] || item.id
    }));
};

/**
 * 記録データ(UUIDキー)を、日本語キーのデータに変換します
 */
export const convertDataToReadable = (data: Record<string, FormValue>, schema: FormItem[]) => {
    const keyMap = generateKeyMap(schema);
    const newData: Record<string, FormValue> = {};

    Object.keys(data).forEach(key => {
        // detail項目の処理 (uuid_detail -> 日本語_詳細)
        if (key.endsWith('_detail')) {
            const originalId = key.replace('_detail', '');
            const newKey = keyMap[originalId] ? `${keyMap[originalId]}_詳細` : key;
            newData[newKey] = data[key];
        }
        // 通常項目の処理
        else if (keyMap[key]) {
            newData[keyMap[key]] = data[key];
        }
        // マップにないもの（基本情報など）はそのまま維持
        else {
            newData[key] = data[key];
        }
    });

    return newData;
};