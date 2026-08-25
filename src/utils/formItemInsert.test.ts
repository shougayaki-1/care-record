import { describe, expect, it } from 'vitest';
import { insertFormItem } from './formItemInsert';

describe('insertFormItem', () => {
  it('inserting between B and C produces [A, B, new, C]', () => {
    const items = ['A', 'B', 'C'];
    const result = insertFormItem(items, 'new', 2);
    expect(result).toEqual(['A', 'B', 'new', 'C']);
    // Original array must not be mutated.
    expect(items).toEqual(['A', 'B', 'C']);
  });

  it('inserting at index 0 prepends', () => {
    expect(insertFormItem(['A', 'B'], 'new', 0)).toEqual(['new', 'A', 'B']);
  });

  it('inserting at length appends', () => {
    expect(insertFormItem(['A', 'B'], 'new', 2)).toEqual(['A', 'B', 'new']);
  });

  it('negative index clamps to prepend', () => {
    expect(insertFormItem(['A', 'B'], 'new', -5)).toEqual(['new', 'A', 'B']);
  });

  it('too-large index clamps to append', () => {
    expect(insertFormItem(['A', 'B'], 'new', 99)).toEqual(['A', 'B', 'new']);
  });

  it('does not mutate the original array reference or contents', () => {
    const items = ['A', 'B', 'C'];
    const original = items;
    insertFormItem(items, 'new', 1);
    expect(items).toBe(original);
    expect(items).toEqual(['A', 'B', 'C']);
  });
});
