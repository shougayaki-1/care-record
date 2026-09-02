import { describe, expect, it } from 'vitest';
import { groupFormSections } from './formSections';

type Item = { id: string; label: string; type: string };

describe('groupFormSections', () => {
  it('groups leading non-section items under the default "基本項目" title', () => {
    const items: Item[] = [
      { id: '1', label: 'Q1', type: 'text' },
      { id: '2', label: 'Q2', type: 'text' },
    ];
    expect(groupFormSections(items)).toEqual([
      { title: '基本項目', items: [items[0], items[1]] },
    ]);
  });

  it('starts a new section on a section-type item', () => {
    const items: Item[] = [
      { id: '1', label: 'Q1', type: 'text' },
      { id: 's1', label: 'セクション1', type: 'section' },
      { id: '2', label: 'Q2', type: 'text' },
    ];
    expect(groupFormSections(items)).toEqual([
      { title: '基本項目', items: [items[0]] },
      { title: 'セクション1', items: [items[2]] },
    ]);
  });

  it('does not emit an empty leading default section when the first item is a section', () => {
    const items: Item[] = [
      { id: 's1', label: 'セクション1', type: 'section' },
      { id: '1', label: 'Q1', type: 'text' },
    ];
    expect(groupFormSections(items)).toEqual([
      { title: 'セクション1', items: [items[1]] },
    ]);
  });

  it('drops a middle section heading that ends up with zero items', () => {
    const items: Item[] = [
      { id: 's1', label: '空セクション', type: 'section' },
      { id: 's2', label: 'セクション2', type: 'section' },
      { id: '1', label: 'Q1', type: 'text' },
    ];
    expect(groupFormSections(items)).toEqual([
      { title: 'セクション2', items: [items[2]] },
    ]);
  });

  it('keeps a trailing section heading even when it ends up with zero items', () => {
    const items: Item[] = [
      { id: '1', label: 'Q1', type: 'text' },
      { id: 's1', label: '末尾セクション', type: 'section' },
    ];
    expect(groupFormSections(items)).toEqual([
      { title: '基本項目', items: [items[0]] },
      { title: '末尾セクション', items: [] },
    ]);
  });

  it('returns an empty array for an empty item list', () => {
    expect(groupFormSections([])).toEqual([]);
  });
});
