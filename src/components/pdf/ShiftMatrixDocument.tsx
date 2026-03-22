import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

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

const styles = StyleSheet.create({
    // ★修正: フッター用の余白を paddingBottom で確保
    page: { padding: 15, paddingBottom: 30, fontFamily: 'NotoSansJP', fontSize: 6, color: '#333' },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    title: { fontSize: 14, fontWeight: 'bold', color: '#2255CC' },
    month: { fontSize: 12 },
    table: { width: '100%', borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#ccc' },
    row: { flexDirection: 'row' },
    headerRow: { backgroundColor: '#F0F5FF' },
    headerCell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#ccc', textAlign: 'center', paddingVertical: 4, fontWeight: 'bold' },
    staffCell: { width: 50, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#ccc', padding: 2, justifyContent: 'center' },
    dayCell: { flex: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#ccc', padding: 1, textAlign: 'center', minHeight: 30 },
    shiftText: { fontSize: 4.5, marginBottom: 2, lineHeight: 1.2, textAlign: 'center' },
    shiftBox: { backgroundColor: '#F0F5FF', padding: 1, marginBottom: 1, borderRadius: 1 },
    
    // ★修正: 絶対配置で確実に一番下へ置く
    footer: { position: 'absolute', bottom: 10, left: 15, right: 15, textAlign: 'right', fontSize: 8, color: '#666', borderTopWidth: 1, borderColor: '#ccc', paddingTop: 5 }
});

export type MatrixStaffData = {
    staffName: string;
    shiftsByDay: {
        [day: number]: string[];
    };
};

type Props = {
    title: string;
    monthStr: string;
    daysInMonth: number;
    staffData: MatrixStaffData[];
    orgName: string; 
};

export const ShiftMatrixDocument = ({ title, monthStr, daysInMonth, staffData, orgName }: Props) => {
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    return (
        <Document>
            <Page size="A4" orientation="landscape" style={styles.page}>
                <View style={styles.header}>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.month}>{monthStr}</Text>
                </View>
                <View style={styles.table}>
                    <View style={[styles.row, styles.headerRow]}>
                        <Text style={[styles.headerCell, { width: 50 }]}>スタッフ名</Text>
                        {days.map(d => (
                            <Text key={d} style={[styles.headerCell, { flex: 1 }]}>{d}</Text>
                        ))}
                    </View>
                    {staffData.map((staff, i) => (
                        <View key={i} style={styles.row}>
                            <View style={styles.staffCell}>
                                <Text>{staff.staffName}</Text>
                            </View>
                            {days.map(d => {
                                const shifts = staff.shiftsByDay[d] || [];
                                return (
                                    <View key={d} style={styles.dayCell}>
                                        {shifts.map((s, idx) => (
                                            <View key={idx} style={styles.shiftBox}>
                                                <Text style={styles.shiftText}>{s}</Text>
                                            </View>
                                        ))}
                                    </View>
                                )
                            })}
                        </View>
                    ))}
                </View>

                {/* ★修正: ページ番号と事業所名を出す（fixedで全ページに出力） */}
                <Text style={styles.footer} fixed>
                    {orgName}
                </Text>
            </Page>
        </Document>
    );
};