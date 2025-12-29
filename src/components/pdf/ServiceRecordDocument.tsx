import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, Svg, Polyline } from '@react-pdf/renderer';

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

// --- 2. スタイル定義 (ご提示のデザイン) ---
const styles = StyleSheet.create({
    page: {
        padding: 15,
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        color: '#333',
        lineHeight: 1.2,
    },

    // ヘッダー部
    header: {
        marginBottom: 5,
        borderBottomWidth: 1,
        borderColor: '#444',
        paddingBottom: 2,
    },
    title: {
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 4,
        color: '#000',
        textAlign: 'center',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 4,
    },
    headerLabel: { fontSize: 7, color: '#666', marginBottom: 1 },
    headerValue: { fontSize: 9, fontWeight: 'bold', color: '#000' },

    // ヘッダー内の情報ボックス
    infoBox: {
        flexDirection: 'row',
        backgroundColor: '#f5f5f5',
        padding: 4,
        borderRadius: 2,
        marginTop: 2,
    },
    infoItem: { marginRight: 12, flexDirection: 'row', alignItems: 'flex-end' },

    // --- カラムレイアウト ---
    columnsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 5,
    },
    column: {
        width: '49%',
        flexDirection: 'column',
    },

    // セクション
    sectionBlock: {
        marginBottom: 6,
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 3,
        padding: 4,
    },
    sectionHeader: {
        backgroundColor: '#eee',
        fontSize: 8,
        fontWeight: 'bold',
        padding: 2,
        marginBottom: 3,
        color: '#000',
    },

    // 項目行
    itemRow: {
        flexDirection: 'row',
        marginBottom: 2,
        alignItems: 'flex-start',
        minHeight: 10,
    },

    // チェックボックス枠（SVG描画用コンテナ）
    checkBoxContainer: {
        width: 9,
        height: 9,
        borderWidth: 1,
        borderColor: '#555',
        marginRight: 4,
        marginTop: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },

    // タグ
    tagContainer: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 1 },
    tag: {
        marginRight: 3, marginBottom: 2, paddingHorizontal: 3, paddingVertical: 0,
        borderWidth: 1, borderRadius: 3,
        fontSize: 7,
    },
    tagActive: { borderColor: '#000', backgroundColor: '#ddd', color: '#000' },
    tagInactive: { borderColor: '#ddd', backgroundColor: 'transparent', color: '#999' },

    // フッター
    footer: {
        marginTop: 5,
        borderTopWidth: 1,
        borderColor: '#ccc',
        paddingTop: 5,
    },
    noteBox: {
        minHeight: 35,
        borderWidth: 1, borderColor: '#ddd', borderRadius: 3,
        padding: 3, backgroundColor: '#fafafa', marginBottom: 5
    },
    sealContainer: { flexDirection: 'row', justifyContent: 'flex-end' },
    sealBox: {
        width: 50, height: 50,
        borderWidth: 1, borderColor: '#ccc', marginLeft: 5,
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

// 除外ロジック
const isExcluded = (item: any) => {
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

// チェックボックス (SVG)
const CheckBox = ({ checked, label }: { checked: boolean, label: string }) => (
    <View style={styles.itemRow}>
        <View style={styles.checkBoxContainer}>
            {checked && (
                <Svg width="8" height="8" viewBox="0 0 10 10">
                    <Polyline points="2,5 4,8 8,2" stroke="#000" strokeWidth="1.5" fill="none" />
                </Svg>
            )}
        </View>
        <Text style={{ flex: 1 }}>{label}</Text>
    </View>
);

// キー・バリュー表示
const KeyValue = ({ label, value }: { label: string, value: any }) => (
    <View style={styles.itemRow}>
        <Text style={{ color: '#555', marginRight: 3 }}>{label}:</Text>
        <Text style={{ borderBottomWidth: 1, borderColor: '#ddd', minWidth: 20, textAlign: 'center', fontWeight: 'bold' }}>
            {value || '-'}
        </Text>
    </View>
);

// タグ表示
const Tags = ({ label, options, values }: { label: string, options: string[], values: string[] }) => (
    <View style={{ marginBottom: 3 }}>
        <Text style={{ color: '#555', marginBottom: 1 }}>{label}:</Text>
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

// --- 5. メインコンポーネント (一括出力対応) ---
// 配列 reports を受け取るように変更
export const ServiceRecordDocument = ({ reports }: { reports: any[] }) => {
    return (
        <Document>
            {reports.map((report, pageIndex) => {
                const { data, template, clientName, helperName, startAt, endAt } = report;

                // データ取得ヘルパー
                const getValue = (id: string) => data[id];
                const getList = (id: string) => {
                    const v = data[id];
                    if (Array.isArray(v)) return v;
                    if (typeof v === 'string') return [v];
                    return [];
                };

                // セクション整理ロジック (ページごとに実行)
                const sections: any[] = [];
                let currentSection: any = null;

                template.forEach((item: any) => {
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

                // カラム振り分け
                const leftColumn: any[] = [];
                const rightColumn: any[] = [];
                sections.forEach((sec, index) => {
                    if (index % 2 === 0) leftColumn.push(sec);
                    else rightColumn.push(sec);
                });

                // セクション描画関数
                const renderSection = (section: any, key: number) => (
                    <View key={key} style={styles.sectionBlock}>
                        <Text style={styles.sectionHeader}>{section.title}</Text>
                        {section.items.map((item: any, i: number) => {
                            if (item.type === 'checkbox') {
                                return <CheckBox key={i} label={item.label} checked={!!data[item.id]} />;
                            }
                            if (['text', 'number', 'time'].includes(item.type)) {
                                return <KeyValue key={i} label={item.label} value={getValue(item.id)} />;
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
                                    <Text style={{ fontSize: 7, marginRight: 3 }}>サービス種別:</Text>
                                    <Text style={{ fontSize: 8, fontWeight: 'bold' }}>重度訪問介護</Text>
                                </View>
                                <View style={styles.infoItem}>
                                    <Text style={{ fontSize: 7, marginRight: 3 }}>サービス時間:</Text>
                                    <Text style={{ fontSize: 8, fontWeight: 'bold' }}>{getValue('service_time') || 0} h</Text>
                                </View>
                                <View style={styles.infoItem}>
                                    <Text style={{ fontSize: 7, marginRight: 3 }}>移動時間:</Text>
                                    <Text style={{ fontSize: 8, fontWeight: 'bold' }}>{getValue('travel_time') || 0} h</Text>
                                </View>
                            </View>
                        </View>

                        {/* コンテンツ (2カラム) */}
                        <View style={styles.columnsContainer}>
                            <View style={styles.column}>
                                {leftColumn.map((sec, i) => renderSection(sec, i))}
                            </View>
                            <View style={styles.column}>
                                {rightColumn.map((sec, i) => renderSection(sec, i))}
                            </View>
                        </View>

                        {/* フッター */}
                        <View style={styles.footer}>
                            <Text style={{ fontSize: 8, fontWeight: 'bold', marginBottom: 2 }}>【特記事項】</Text>
                            <View style={styles.noteBox}>
                                <Text>{getValue('special_note')}</Text>
                                <Text>{getValue('note')}</Text>
                                <Text>{getValue('other_note')}</Text>
                            </View>

                            <View style={styles.sealContainer}>
                                <View style={styles.sealBox}>
                                    <Text style={{ fontSize: 6, width: '100%', textAlign: 'center', borderBottomWidth: 1, borderColor: '#eee' }}>管理者</Text>
                                </View>
                                <View style={styles.sealBox}>
                                    <Text style={{ fontSize: 6, width: '100%', textAlign: 'center', borderBottomWidth: 1, borderColor: '#eee' }}>責任者</Text>
                                </View>
                            </View>
                        </View>

                    </Page>
                );
            })}
        </Document>
    );
};