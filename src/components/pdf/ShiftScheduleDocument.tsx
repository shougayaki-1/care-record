import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import type { PdfStaffMember } from './ShiftCalendarDocument';

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
        padding: 15, 
        paddingBottom: 25, 
        fontFamily: 'NotoSansJP', 
        fontSize: 11.5, 
        color: '#333' 
    },
    header: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        marginBottom: 10, 
        borderBottomWidth: 1, 
        borderColor: '#2255CC', 
        paddingBottom: 5 
    },
    title: { fontSize: 16, fontWeight: 'bold', color: '#2255CC' },
    month: { fontSize: 12 },
    staffSection: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginBottom: 10,
        paddingBottom: 6,
        borderBottomWidth: 1,
        borderColor: '#E3E5E8',
    },
    staffSectionLabel: { fontSize: 10, fontWeight: 'bold', color: '#555', marginRight: 6 },
    staffChip: {
        flexDirection: 'row',
        backgroundColor: '#F0F5FF',
        borderRadius: 3,
        paddingVertical: 2,
        paddingHorizontal: 6,
        marginRight: 6,
        marginBottom: 4,
    },
    staffChipName: { fontSize: 10, fontWeight: 'bold', color: '#333' },
    staffChipDetail: { fontSize: 9.5, color: '#2255CC', marginLeft: 3 },
    table: { width: '100%', borderWidth: 1, borderColor: '#ddd' },
    tableHeader: { flexDirection: 'row', backgroundColor: '#F0F5FF', borderBottomWidth: 1, borderColor: '#ddd', fontWeight: 'bold' },
    tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd', minHeight: 26, alignItems: 'center' },
    tableRowCancelled: { backgroundColor: '#f9f9f9', color: '#999' },
    // 各列の文字を 10.5pt、行間 1.0（ぎりぎり重ならない密着度）にして詰め込みます
    colDate: { width: '15%', padding: 4, borderRightWidth: 1, borderColor: '#ddd', textAlign: 'center', fontSize: 10.5, lineHeight: 1.0 },
    colTime: { width: '20%', padding: 4, borderRightWidth: 1, borderColor: '#ddd', textAlign: 'center', fontSize: 10.5, lineHeight: 1.0 },
    colClient: { width: '25%', padding: 4, borderRightWidth: 1, borderColor: '#ddd', fontSize: 10.5, lineHeight: 1.0 },
    colStaff: { width: '25%', padding: 4, borderRightWidth: 1, borderColor: '#ddd', fontSize: 10.5, lineHeight: 1.0 },
    colStatus: { width: '15%', padding: 4, textAlign: 'center', fontSize: 10.5, lineHeight: 1.0 },
    footer: { 
        position: 'absolute', 
        bottom: 12, 
        left: 15, 
        right: 15, 
        textAlign: 'right', 
        fontSize: 9, 
        color: '#666', 
        borderTopWidth: 1, 
        borderColor: '#ccc', 
        paddingTop: 4 
    }
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
    orgName: string;
    staffMembers?: PdfStaffMember[];
};

export const ShiftScheduleDocument = ({ title, monthStr, shifts, orgName, staffMembers = [] }: Props) => {
    return (
        <Document>
            <Page size="A4" style={styles.page}>
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
                                {[s.employmentType, s.workStyle].filter(Boolean).length > 0 ? (
                                    <Text style={styles.staffChipDetail}>
                                        {[s.employmentType, s.workStyle].filter(Boolean).join('・')}
                                    </Text>
                                ) : null}
                            </View>
                        ))}
                    </View>
                )}

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
                        shifts.map((shift, i) => {
                            const displayName = shift.clientName.endsWith('様') ? shift.clientName : `${shift.clientName} 様`;
                            return (
                                <View key={i} style={[styles.tableRow, shift.isCancelled ? styles.tableRowCancelled : {}]}>
                                    <Text style={styles.colDate}>{shift.dateStr}</Text>
                                    <Text style={styles.colTime}>{shift.startTime} - {shift.endTime}</Text>
                                    <Text style={styles.colClient}>{displayName}</Text>
                                    <Text style={styles.colStaff}>{shift.staffNames}</Text>
                                    <Text style={styles.colStatus}>{shift.isCancelled ? 'お休み' : ''}</Text>
                                </View>
                            );
                        })
                    )}
                </View>

                <Text style={styles.footer} fixed>
                    {orgName}
                </Text>
            </Page>
        </Document>
    );
};
