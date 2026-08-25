import { describe, expect, it } from 'vitest';

// Mirrors the non-mutating insert used by addField() in
// src/app/app/clients/[id]/page.tsx: build a new array via slice/spread,
// never mutate the existing formItems array in place.
function insertAt<T>(items: T[], insertIndex: number, newItem: T): T[] {
  const clampedIndex = Math.max(0, Math.min(insertIndex, items.length));
  return [...items.slice(0, clampedIndex), newItem, ...items.slice(clampedIndex)];
}

describe('form item insert-between', () => {
  it('inserting between B and C produces [A, B, new, C]', () => {
    const items = ['A', 'B', 'C'];
    const result = insertAt(items, 2, 'new');
    expect(result).toEqual(['A', 'B', 'new', 'C']);
    // Original array must not be mutated.
    expect(items).toEqual(['A', 'B', 'C']);
  });

  it('inserting at index 0 prepends', () => {
    expect(insertAt(['A', 'B'], 0, 'new')).toEqual(['new', 'A', 'B']);
  });

  it('inserting at length appends', () => {
    expect(insertAt(['A', 'B'], 2, 'new')).toEqual(['A', 'B', 'new']);
  });
});
