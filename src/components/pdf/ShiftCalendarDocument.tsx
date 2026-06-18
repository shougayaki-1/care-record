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
    page: { 
        padding: 12, 
        paddingBottom: 25, 
        fontFamily: 'NotoSansJP', 
        fontSize: 10, 
        color: '#333' 
    },
    header: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        marginBottom: 8, 
        borderBottomWidth: 1, 
        borderColor: '#2255CC', 
        paddingBottom: 4 
    },
    title: { fontSize: 14, fontWeight: 'bold', color: '#2255CC' },
    month: { fontSize: 11 },
    staffSection: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginBottom: 8,
        paddingBottom: 6,
        borderBottomWidth: 1,
        borderColor: '#E3E5E8',
    },
    staffSectionLabel: {
        fontSize: 9,
        fontWeight: 'bold',
        color: '#555',
        marginRight: 6,
    },
    staffChip: {
        flexDirection: 'row',
        backgroundColor: '#F0F5FF',
        borderRadius: 3,
        paddingVertical: 2,
        paddingHorizontal: 5,
        marginRight: 5,
        marginBottom: 3,
    },
    staffChipName: { fontSize: 9, fontWeight: 'bold', color: '#333' },
    staffChipPosition: { fontSize: 8.5, color: '#2255CC', marginLeft: 3 },
    calendar: { width: '100%', borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#ccc' },
    dayHeaderRow: { flexDirection: 'row', backgroundColor: '#F0F5FF' },
    dayHeaderCell: { 
        width: '14.28%', 
        textAlign: 'center', 
        padding: 3, 
        borderRightWidth: 1, 
        borderBottomWidth: 1, 
        borderColor: '#ccc', 
        fontWeight: 'bold', 
        fontSize: 9 
    },
    weekRow: { flexDirection: 'row' },
    dayCell: { 
        width: '14.28%', 
        minHeight: 105, 
        borderRightWidth: 1, 
        borderBottomWidth: 1, 
        borderColor: '#ccc', 
        padding: 1.5 
    },
    dateNumber: { 
        fontSize: 9, 
        color: '#666', 
        marginBottom: 1, 
        textAlign: 'right', 
        paddingRight: 4 
    },
    eventBox: { 
        backgroundColor: '#E6F0FF', 
        padding: 1, 
        paddingHorizontal: 2, 
        marginBottom: 1, 
        borderRadius: 2, 
        minHeight: 36,        // 固定高さを廃止し、文字量に応じて自動で伸びるように変更
        justifyContent: 'center' 
    },
    eventBoxCancelled: { backgroundColor: '#F2F3F5' },
    eventTime: { 
        fontSize: 8.5, 
        fontWeight: 'bold', 
        color: '#2255CC', 
        marginBottom: 0.5
        // maxLines と textOverflow: 'ellipsis' を削除し、折り返しを許可
    },
    eventText: { 
        fontSize: 8.5, 
        color: '#333', 
        lineHeight: 0.95,     // 行間を極限まで詰め込んで詰め込み表示
        // maxLines と textOverflow: 'ellipsis' を削除し、すべて表示
    },
    eventTextCancelled: { color: '#999', textDecoration: 'line-through' },
    footer: { 
        position: 'absolute', 
        bottom: 10, 
        left: 12, 
        right: 12, 
        textAlign: 'right', 
        fontSize: 8, 
        color: '#666', 
        borderTopWidth: 1, 
        borderColor: '#ccc', 
        paddingTop: 4 
    }
});

export type PdfCalendarEvent = {
    timeStr: string;
    clientName: string;
    staffNames: string;
    isCancelled: boolean;
};

export type PdfCalendarDay = {
    date: Date;
    dateStr: string;
    dayNumber: number;
    events: PdfCalendarEvent[];
};

export type PdfStaffMember = {
    name: string;
    positions?: string[] | null;
};

type Props = {
    title: string;
    monthStr: string;
    weeks: PdfCalendarDay[][];
    orgName: string;
    staffMembers?: PdfStaffMember[];
};

export const ShiftCalendarDocument = ({ title, monthStr, weeks, orgName, staffMembers = [] }: Props) => {
    return (
        <Document>
            <Page size="A4" orientation="portrait" style={styles.page}>
                <View style={styles.header}>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.month}>{monthStr}</Text>
                </View>

                {staffMembers.length > 0 && (
                    <View style={styles.staffSection}>
                        <Text style={styles.staffSectionLabel}>スタッフ：</Text>
                        {staffMembers.map((s, i) => (
                            <View key={i} style={styles.staffChip}>
                                <Text style={styles.staffChipName}>{s.name}</Text>
                                {s.positions && s.positions.length > 0 ? <Text style={styles.staffChipPosition}>{s.positions.join('・')}</Text> : null}
                            </View>
                        ))}
                    </View>
                )}

                <View style={styles.calendar}>
                    <View style={styles.dayHeaderRow}>
                        {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                            <Text key={i} style={styles.dayHeaderCell}>{d}</Text>
                        ))}
                    </View>
                    {weeks.map((week, wIdx) => (
                        <View key={wIdx} style={styles.weekRow} wrap={false}>
                            {week.map((day, dIdx) => (
                                <View key={dIdx} style={styles.dayCell}>
                                    <Text style={styles.dateNumber}>{day.dayNumber}</Text>
                                    {day.events.map((ev, eIdx) => {
                                        const displayName = ev.clientName.endsWith('様') ? ev.clientName : `${ev.clientName}様`;
                                        const staffDisplay = ev.staffNames ? `(${ev.staffNames})` : '';
                                        return (
                                            <View key={eIdx} style={[styles.eventBox, ev.isCancelled ? styles.eventBoxCancelled : {}]}>
                                                <Text style={[styles.eventTime, ev.isCancelled ? styles.eventTextCancelled : {}]}>
                                                    {ev.timeStr}
                                                </Text>
                                                <Text style={[styles.eventText, ev.isCancelled ? styles.eventTextCancelled : {}]}>
                                                    {displayName}{staffDisplay}
                                                </Text>
                                            </View>
                                        );
                                    })}
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
                
                <Text style={styles.footer} fixed>
                    {orgName}
                </Text>
            </Page>
        </Document>
    );
};