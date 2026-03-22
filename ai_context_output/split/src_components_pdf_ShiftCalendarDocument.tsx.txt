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
    page: { padding: 20, fontFamily: 'NotoSansJP', fontSize: 9, color: '#333' },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, borderBottomWidth: 1, borderColor: '#2255CC', paddingBottom: 5 },
    title: { fontSize: 16, fontWeight: 'bold', color: '#2255CC' },
    month: { fontSize: 12 },
    calendar: { width: '100%', borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#ccc' },
    dayHeaderRow: { flexDirection: 'row', backgroundColor: '#F0F5FF' },
    dayHeaderCell: { width: '14.28%', textAlign: 'center', padding: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#ccc', fontWeight: 'bold' },
    weekRow: { flexDirection: 'row' },
    dayCell: { width: '14.28%', minHeight: 80, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#ccc', padding: 2 },
    dateNumber: { fontSize: 9, color: '#666', marginBottom: 2, textAlign: 'right', paddingRight: 4 },
    eventBox: { backgroundColor: '#E6F0FF', padding: 2, marginBottom: 2, borderRadius: 2 },
    eventBoxCancelled: { backgroundColor: '#F2F3F5' },
    eventTime: { fontSize: 7, fontWeight: 'bold', color: '#2255CC', marginBottom: 1 },
    eventText: { fontSize: 7, color: '#333' },
    eventTextCancelled: { color: '#999', textDecoration: 'line-through' },
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

type Props = {
    title: string;
    monthStr: string;
    weeks: PdfCalendarDay[][];
};

export const ShiftCalendarDocument = ({ title, monthStr, weeks }: Props) => {
    return (
        <Document>
            <Page size="A4" orientation="landscape" style={styles.page}>
                <View style={styles.header}>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.month}>{monthStr}</Text>
                </View>
                <View style={styles.calendar}>
                    <View style={styles.dayHeaderRow}>
                        {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                            <Text key={i} style={styles.dayHeaderCell}>{d}</Text>
                        ))}
                    </View>
                    {weeks.map((week, wIdx) => (
                        <View key={wIdx} style={styles.weekRow}>
                            {week.map((day, dIdx) => (
                                <View key={dIdx} style={styles.dayCell}>
                                    <Text style={styles.dateNumber}>{day.dayNumber}</Text>
                                    {day.events.map((ev, eIdx) => {
                                        // ★修正: 「様」がついていなければ付与
                                        const displayName = ev.clientName.endsWith('様') ? ev.clientName : `${ev.clientName} 様`;
                                        return (
                                            <View key={eIdx} style={[styles.eventBox, ev.isCancelled ? styles.eventBoxCancelled : {}]}>
                                                <Text style={[styles.eventTime, ev.isCancelled ? styles.eventTextCancelled : {}]}>
                                                    {ev.timeStr}
                                                </Text>
                                                <Text style={[styles.eventText, ev.isCancelled ? styles.eventTextCancelled : {}]}>
                                                    {displayName}
                                                </Text>
                                                {ev.staffNames && (
                                                    <Text style={[styles.eventText, ev.isCancelled ? styles.eventTextCancelled : {}]}>
                                                        ({ev.staffNames})
                                                    </Text>
                                                )}
                                            </View>
                                        );
                                    })}
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
            </Page>
        </Document>
    );
};