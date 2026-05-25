/**
 * 対象月期間と、シフト時間におけるオーバーラップ時間（h）を算出する純粋なヘルパー関数
 */
export function getOverlappingHours(start: Date, end: Date, monthStart: Date, monthEnd: Date): number {
    const overlapStart = start > monthStart ? start : monthStart;
    const overlapEnd = end < monthEnd ? end : monthEnd;
    if (overlapStart >= overlapEnd) return 0;
    return (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
}