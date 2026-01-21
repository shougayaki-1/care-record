import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, Svg, Polyline } from '@react-pdf/renderer';

// --- 型定義 ---
type FormItem = {
    id: string;
    label: string;
    type: string;
    options?: string;
    required?: boolean;
    hasDetail?: boolean;
};

type ReportValue = string | number | boolean | string[] | null | undefined;
type ReportDataMap = Record<string, ReportValue>;

export type PdfReportData = {
    id: string;
    clientName: string;
    helperName: string;
    startAt: string;
    endAt: string;
    data: ReportDataMap;
    template: FormItem[];
};

type Section = {
    title: string;
    items: FormItem[];
};

// --- 1. フォント設定 ---
const getFontUrl = (filename: string) => {
    return typeof window !== 'undefined'
        ? `${window.location.origin}/fonts/${filename}`
        : `/fonts/${filename}`;
};

Font.register({
    family: 'NotoSansJP',
    fonts: [
        { src: getFontUrl('NotoSansJP-Regular.ttf'), fontWeight: 'normal' },
        { src: getFontUrl('NotoSansJP-Bold.ttf'), fontWeight: 'bold' },
    ],
});

// --- 2. スタイル定義 ---
const styles = StyleSheet.create({
    page: {
        padding: 15,
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        color: '#333',
        lineHeight: 1.2,
    },

    // --- ヘッダー部 ---
    header: {
        marginBottom: 5,
        borderBottomWidth: 1.5,
        borderColor: '#2255CC',
        paddingBottom: 2,
    },
    title: {
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 3,
        color: '#2255CC',
        textAlign: 'center',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 3,
    },
    headerLabel: { fontSize: 7, color: '#666', marginBottom: 1 },
    headerValue: { fontSize: 9, fontWeight: 'bold', color: '#000' },

    // ヘッダー内の情報ボックス
    infoBox: {
        flexDirection: 'row',
        backgroundColor: '#F0F5FF',
        padding: 4,
        borderRadius: 3,
        marginTop: 3,
        borderWidth: 0.5,
        borderColor: '#D0E0FF',
    },
    infoItem: { marginRight: 12, flexDirection: 'row', alignItems: 'flex-end' },

    // --- コンテンツレイアウト (横並び折り返し) ---
    columnsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap', // 折り返しを有効化
        justifyContent: 'space-between',
        marginTop: 4,
    },
    // 各セクションブロック
    sectionBlock: {
        width: '49%', // 2列配置
        marginBottom: 5,
        borderWidth: 0.5,
        borderColor: '#B0C4DE',
        borderRadius: 3,
        overflow: 'hidden',
        backgroundColor: '#fff',
    },
    sectionHeader: {
        backgroundColor: '#E6F0FF',
        fontSize: 8,
        fontWeight: 'bold',
        padding: 3,
        paddingLeft: 5,
        color: '#003399',
        borderBottomWidth: 0.5,
        borderColor: '#D0E0FF',
    },
    sectionContent: {
        padding: 4,
        paddingBottom: 2,
    },

    // --- 各項目のスタイル統一 ---
    // 共通の行スタイル
    itemRow: {
        marginBottom: 3,
        minHeight: 10,
    },
    // ラベル（項目名）
    label: {
        fontSize: 8,
        color: '#444',
        marginBottom: 1.5,
    },
    
    // チェックボックス行（アイコン＋テキスト）
    checkboxRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    checkBoxContainer: {
        width: 8,
        height: 8,
        borderWidth: 0.5,
        borderColor: '#2255CC',
        marginRight: 4,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 1.5,
    },
    checkboxLabel: {
        fontSize: 8,
        flex: 1,
    },

    // タグ（選択肢）コンテナ
    tagContainer: { 
        flexDirection: 'row', 
        flexWrap: 'wrap',
    },
    tag: {
        marginRight: 2, 
        marginBottom: 2, 
        paddingHorizontal: 4, 
        paddingVertical: 1,
        borderWidth: 0.5, 
        borderRadius: 3,
        fontSize: 7.5, // 読みやすいサイズに統一
    },
    tagActive: { 
        borderColor: '#2255CC', 
        backgroundColor: '#F0F5FF', 
        color: '#2255CC',
        fontWeight: 'bold'
    },
    tagInactive: { 
        borderColor: '#ddd', 
        backgroundColor: '#fff', 
        color: '#888' 
    },

    // テキスト入力値
    valueText: {
        borderBottomWidth: 0.5,
        borderColor: '#aaa',
        paddingHorizontal: 2,
        fontSize: 8,
        fontWeight: 'bold',
        color: '#000',
        minWidth: 30,
        textAlign: 'left', // 左寄せに変更して読みやすく
    },
    valueRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        flexWrap: 'wrap',
    },

    // フッター
    footer: {
        marginTop: 4,
        borderTopWidth: 1,
        borderColor: '#2255CC',
        paddingTop: 4,
    },
    noteBox: {
        minHeight: 30,
        borderWidth: 0.5, borderColor: '#ccc', borderRadius: 3,
        padding: 3, backgroundColor: '#FAFAFA', marginBottom: 4
    },
    sealContainer: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 },
    sealBox: {
        width: 45, height: 45,
        borderWidth: 0.5, borderColor: '#aaa', marginLeft: 8,
        justifyContent: 'space-between', alignItems: 'center', padding: 1
    },
});

// --- 3. ユーティリティ ---
const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const isExcluded = (item: FormItem) => {
    const id = item.id;
    const label = (item.label || '').trim();
    const excludeIds = ['service_time', 'travel_time', 'special_note', 'note', 'other_note'];
    if (excludeIds.includes(id)) return true;
    if (label.includes('障害福祉') && label.includes('時間')) return true;
    if (label.includes('重度訪問介護')) return true;
    if (label.includes('移動') && label.includes('時間')) return true;
    if (['時間', '移動', 'サービス時間'].includes(label)) return true;
    return false;
};

// --- 4. 部品コンポーネント ---

// チェックボックス (T/F)
const CheckBox = ({ checked, label }: { checked: boolean, label: string }) => (
    <View style={styles.checkboxRow}>
        <View style={styles.checkBoxContainer}>
            {checked && (
                <Svg width="6" height="6" viewBox="0 0 10 10">
                    <Polyline points="2,5 4,8 8,2" stroke="#2255CC" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
            )}
        </View>
        <Text style={[styles.checkboxLabel, { color: checked ? '#000' : '#555', fontWeight: checked ? 'bold' : 'normal' }]}>{label}</Text>
    </View>
);

// テキスト・数値入力 (Label: Value)
const KeyValue = ({ label, value }: { label: string, value: string | number | null | undefined }) => (
    <View style={styles.itemRow}>
        <View style={styles.valueRow}>
            <Text style={styles.label}>{label}: </Text>
            <Text style={styles.valueText}>{value || '-'}</Text>
        </View>
    </View>
);

// 選択肢 (Label: [Tag] [Tag]...)
const Tags = ({ label, options, values }: { label: string, options: string[], values: string[] }) => (
    <View style={styles.itemRow}>
        <Text style={styles.label}>{label}:</Text>
        <View style={styles.tagContainer}>
            {options.map((opt, i) => {
                const isSelected = values.includes(opt.trim());
                return (
                    <View key={i} style={[styles.tag, isSelected ? styles.tagActive : styles.tagInactive]}>
                        <Text>{opt.trim()}</Text>
                    </View>
                );
            })}
        </View>
    </View>
);

// --- 5. メインコンポーネント ---
export const ServiceRecordDocument = ({ reports }: { reports: PdfReportData[] }) => {
    return (
        <Document>
            {reports.map((report, pageIndex) => {
                const { data, template, clientName, helperName, startAt, endAt } = report;

                const getValue = (id: string) => data[id];
                const getList = (id: string): string[] => {
                    const v = data[id];
                    if (Array.isArray(v)) return v;
                    if (typeof v === 'string') return [v];
                    return [];
                };

                const sections: Section[] = [];
                let currentSection: Section | null = null;

                template.forEach((item) => {
                    if (isExcluded(item)) return;

                    if (item.type === 'section') {
                        if (currentSection) sections.push(currentSection);
                        currentSection = { title: item.label, items: [] };
                    } else {
                        if (!currentSection) currentSection = { title: 'その他', items: [] };
                        currentSection.items.push(item);
                    }
                });
                if (currentSection) sections.push(currentSection);

                // renderSection関数
                const renderSection = (section: Section, key: number) => (
                    <View key={key} style={styles.sectionBlock}>
                        <Text style={styles.sectionHeader}>{section.title}</Text>
                        <View style={styles.sectionContent}>
                            {section.items.map((item, i) => {
                                if (item.type === 'checkbox') {
                                    return <CheckBox key={i} label={item.label} checked={!!data[item.id]} />;
                                }
                                if (['text', 'number', 'time'].includes(item.type)) {
                                    return <KeyValue key={i} label={item.label} value={getValue(item.id) as string | number | null | undefined} />;
                                }
                                if (['multicheckbox', 'radio', 'select'].includes(item.type)) {
                                    return (
                                        <Tags
                                            key={i}
                                            label={item.label}
                                            options={item.options ? item.options.split(',') : []}
                                            values={getList(item.id)}
                                        />
                                    );
                                }
                                return null;
                            })}
                        </View>
                    </View>
                );

                return (
                    <Page key={pageIndex} size="A4" style={styles.page}>
                        {/* ヘッダー */}
                        <View style={styles.header}>
                            <Text style={styles.title}>サービス提供記録票</Text>
                            <View style={styles.headerRow}>
                                <View style={{ width: '30%' }}>
                                    <Text style={styles.headerLabel}>ご利用者</Text>
                                    <Text style={[styles.headerValue, { fontSize: 11 }]}>{clientName} 様</Text>
                                </View>
                                <View style={{ width: '40%' }}>
                                    <Text style={styles.headerLabel}>サービス提供日時</Text>
                                    <Text style={styles.headerValue}>{formatDate(startAt)}  {formatTime(startAt)}〜{formatTime(endAt)}</Text>
                                </View>
                                <View style={{ width: '25%' }}>
                                    <Text style={styles.headerLabel}>担当ヘルパー</Text>
                                    <Text style={styles.headerValue}>{helperName}</Text>
                                </View>
                            </View>

                            <View style={styles.infoBox}>
                                <View style={styles.infoItem}>
                                    <Text style={{ fontSize: 7, marginRight: 4, color: '#444' }}>サービス種別:</Text>
                                    <Text style={{ fontSize: 8, fontWeight: 'bold' }}>重度訪問介護</Text>
                                </View>
                                <View style={styles.infoItem}>
                                    <Text style={{ fontSize: 7, marginRight: 4, color: '#444' }}>サービス時間:</Text>
                                    <Text style={{ fontSize: 8, fontWeight: 'bold' }}>{getValue('service_time') as string | number || 0} h</Text>
                                </View>
                                <View style={styles.infoItem}>
                                    <Text style={{ fontSize: 7, marginRight: 4, color: '#444' }}>移動時間:</Text>
                                    <Text style={{ fontSize: 8, fontWeight: 'bold' }}>{getValue('travel_time') as string | number || 0} h</Text>
                                </View>
                            </View>
                        </View>

                        {/* コンテンツ (flexWrapで横→下へ流す) */}
                        <View style={styles.columnsContainer}>
                            {sections.map((sec, i) => renderSection(sec, i))}
                        </View>

                        {/* フッター */}
                        <View style={styles.footer}>
                            <Text style={{ fontSize: 8, fontWeight: 'bold', marginBottom: 2, color: '#2255CC' }}>【特記事項】</Text>
                            <View style={styles.noteBox}>
                                <Text>{getValue('special_note') as string}</Text>
                                <Text>{getValue('note') as string}</Text>
                                <Text>{getValue('other_note') as string}</Text>
                            </View>

                            <View style={styles.sealContainer}>
                                <View style={styles.sealBox}>
                                    <Text style={{ fontSize: 5, width: '100%', textAlign: 'center', borderBottomWidth: 0.5, borderColor: '#ccc', marginBottom: 15 }}>管理者</Text>
                                </View>
                                <View style={styles.sealBox}>
                                    <Text style={{ fontSize: 5, width: '100%', textAlign: 'center', borderBottomWidth: 0.5, borderColor: '#ccc', marginBottom: 15 }}>責任者</Text>
                                </View>
                            </View>
                        </View>
                    </Page>
                );
            })}
        </Document>
    );
};