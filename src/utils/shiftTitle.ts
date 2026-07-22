/** シフトに表示する利用者・担当スタッフ名を一箇所で組み立てる。 */
export function buildShiftTitle(clientName: string, staffNames: readonly string[]): string {
  const uniqueStaffNames = [...new Set(staffNames.map((name) => name.trim()).filter(Boolean))];
  return clientName + (uniqueStaffNames.length > 0 ? ` (${uniqueStaffNames.join(', ')})` : '');
}
