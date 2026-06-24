import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { brand, blueTint } from '../../styles/tokens';

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
        padding: 10, 
        paddingBottom: 20, 
        fontFamily: 'NotoSansJP', 
        fontSize: 6.5, 
        color: '#333' 
    },
    header: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        marginBottom: 6 
    },
    title: { fontSize: 14, fontWeight: 'bold', color: brand.primary },
    month: { fontSize: 12 },
    table: { width: '100%', borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#ccc' },
    row: { flexDirection: 'row' },
    headerRow: { backgroundColor: blueTint[50] },
    headerCell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#ccc', textAlign: 'center', paddingVertical: 4, fontWeight: 'bold' },
    staffCell: { 
        width: 45, 
        borderRightWidth: 1, 
        borderBottomWidth: 1, 
        borderColor: '#ccc', 
        padding: 2, 
        justifyContent: 'center' 
    },
    staffName: {
        fontSize: 6.5,
        fontWeight: 'bold',
        lineHeight: 1.05,
    },
    staffMeta: {
        fontSize: 5.3,
        color: '#555',
        lineHeight: 1.05,
        marginTop: 1,
    },
    dayCell: { 
        flex: 1, 
        borderRightWidth: 1, 
        borderBottomWidth: 1, 
        borderColor: '#ccc', 
        padding: 0.5, 
        textAlign: 'center', 
        minHeight: 30 
    },
    shiftText: { 
        fontSize: 5.8, 
        marginBottom: 1, 
        lineHeight: 0.95,     // 行間を 0.95 まで詰めて、限られたマス内に極力収めます
        textAlign: 'center' 
    },
    shiftBox: { 
        backgroundColor: blueTint[50], 
        padding: 0.5, 
        marginBottom: 1, 
        borderRadius: 1 
    },
    footer: { 
        position: 'absolute', 
        bottom: 8, 
        left: 10, 
        right: 10, 
        textAlign: 'right', 
        fontSize: 8, 
        color: '#666', 
        borderTopWidth: 1, 
        borderColor: '#ccc', 
        paddingTop: 4 
    }
});

export type MatrixStaffData = {
    staffName: string;
    employmentType?: string;
    assignmentType?: string;
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
                                <Text style={styles.staffName}>{staff.staffName}</Text>
                                {(staff.employmentType || staff.assignmentType) && (
                                    <Text style={styles.staffMeta}>
                                        {[staff.employmentType, staff.assignmentType].filter(Boolean).join(' / ')}
                                    </Text>
                                )}
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

                <Text style={styles.footer} fixed>
                    {orgName}
                </Text>
            </Page>
        </Document>
    );
};
