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
    page: { padding: 20, paddingBottom: 35, fontFamily: 'NotoSansJP', fontSize: 10, color: '#333' },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, borderBottomWidth: 1, borderColor: '#2255CC', paddingBottom: 5 },
    title: { fontSize: 14, fontWeight: 'bold', color: '#2255CC' },
    month: { fontSize: 11 },
    calendar: { width: '100%', borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#ccc' },
    dayHeaderRow: { flexDirection: 'row', backgroundColor: '#F0F5FF' },
    dayHeaderCell: { width: '14.28%', textAlign: 'center', padding: 4, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#ccc', fontWeight: 'bold', fontSize: 8 },
    weekRow: { flexDirection: 'row' },
    dayCell: { width: '14.28%', minHeight: 100, borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#ccc', padding: 2 },
    dateNumber: { fontSize: 8, color: '#666', marginBottom: 2, textAlign: 'right', paddingRight: 4 },
    eventBox: { backgroundColor: '#E6F0FF', padding: 2, paddingHorizontal: 3, marginBottom: 2, borderRadius: 2, height: 36, justifyContent: 'center' },
    eventBoxCancelled: { backgroundColor: '#F2F3F5' },
    eventTime: { fontSize: 7.2, fontWeight: 'bold', color: '#2255CC', marginBottom: 0.5, maxLines: 1, textOverflow: 'ellipsis' },
    eventText: { fontSize: 7.2, color: '#333', lineHeight: 1.1, maxLines: 2, textOverflow: 'ellipsis' },
    eventTextCancelled: { color: '#999', textDecoration: 'line-through' },
    footer: { position: 'absolute', bottom: 15, left: 20, right: 20, textAlign: 'right', fontSize: 8, color: '#666', borderTopWidth: 1, borderColor: '#ccc', paddingTop: 5 }
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
    orgName: string; 
};

export const ShiftCalendarDocument = ({ title, monthStr, weeks, orgName }: Props) => {
    return (
        <Document>
            <Page size="A4" orientation="portrait" style={styles.page}>
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