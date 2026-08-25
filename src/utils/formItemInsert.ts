/**
 * Insert `newItem` into `items` at `insertIndex` without mutating the input array.
 * `insertIndex` is clamped to the valid range [0, items.length].
 */
export function insertFormItem<T>(items: readonly T[], newItem: T, insertIndex: number): T[] {
    const clampedIndex = Math.max(0, Math.min(insertIndex, items.length));
    return [...items.slice(0, clampedIndex), newItem, ...items.slice(clampedIndex)];
}
