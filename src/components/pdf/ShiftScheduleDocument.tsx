import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

const getFontUrl = (filename: string) => {
    return typeof window !== 'undefined'
        ? `${window.location.origin}/fonts/${filename}`
        : `/fonts/${filename}`;
};

// 日本語フォントの読み込み
Font.register({
    family: 'NotoSansJP',
    fonts: [
        { src: getFontUrl('NotoSansJP-Regular.ttf'), fontWeight: 'normal' },
        { src: getFontUrl('NotoSansJP-Bold.ttf'), fontWeight: 'bold' },
    ],
});

const styles = StyleSheet.create({
    page: { padding: 30, fontFamily: 'NotoSansJP', fontSize: 10, color: '#333' },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, borderBottomWidth: 1, borderColor: '#2255CC', paddingBottom: 10 },
    title: { fontSize: 16, fontWeight: 'bold', color: '#2255CC' },
    month: { fontSize: 12 },
    table: { width: '100%', borderWidth: 1, borderColor: '#ddd' },
    tableHeader: { flexDirection: 'row', backgroundColor: '#F0F5FF', borderBottomWidth: 1, borderColor: '#ddd', fontWeight: 'bold' },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd', minHeight: 24, alignItems: 'center' },
    tableRowCancelled: { backgroundColor: '#f9f9f9', color: '#999' },
    colDate: { width: '15%', padding: 5, borderRightWidth: 1, borderColor: '#ddd', textAlign: 'center' },
    colTime: { width: '20%', padding: 5, borderRightWidth: 1, borderColor: '#ddd', textAlign: 'center' },
    colClient: { width: '25%', padding: 5, borderRightWidth: 1, borderColor: '#ddd' },
    colStaff: { width: '25%', padding: 5, borderRightWidth: 1, borderColor: '#ddd' },
    colStatus: { width: '15%', padding: 5, textAlign: 'center' },
});

export type PdfShiftData = {
    dateStr: string;   
    startTime: string; 
    endTime: string;   
    clientName: string;
    staffNames: string;
    isCancelled: boolean;
    timestamp: number; 
};

type Props = {
    title: string;
    monthStr: string;
    shifts: PdfShiftData[];
};

export const ShiftScheduleDocument = ({ title, monthStr, shifts }: Props) => {
    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <View style={styles.header}>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.month}>{monthStr}</Text>
                </View>

                <View style={styles.table}>
                    <View style={styles.tableHeader}>
                        <Text style={styles.colDate}>日付</Text>
                        <Text style={styles.colTime}>時間</Text>
                        <Text style={styles.colClient}>利用者様</Text>
                        <Text style={styles.colStaff}>担当スタッフ</Text>
                        <Text style={styles.colStatus}>備考</Text>
                    </View>

                    {shifts.length === 0 ? (
                        <View style={styles.tableRow}>
                            <Text style={{ width: '100%', padding: 10, textAlign: 'center', color: '#666' }}>予定はありません</Text>
                        </View>
                    ) : (
                        shifts.map((shift, i) => (
                            // エラー解消：配列内に boolean を直接入れず、三項演算子で空オブジェクトを渡すように修正
                            <View key={i} style={[styles.tableRow, shift.isCancelled ? styles.tableRowCancelled : {}]}>
                                <Text style={styles.colDate}>{shift.dateStr}</Text>
                                <Text style={styles.colTime}>{shift.startTime} - {shift.endTime}</Text>
                                <Text style={styles.colClient}>{shift.clientName}</Text>
                                <Text style={styles.colStaff}>{shift.staffNames}</Text>
                                <Text style={styles.colStatus}>{shift.isCancelled ? 'お休み' : ''}</Text>
                            </View>
                        ))
                    )}
                </View>
            </Page>
        </Document>
    );
};