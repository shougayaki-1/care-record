// Shared section-grouping logic for the record form (useRecordForm.ts) and its
// preview (FormPreviewDialog.tsx). Keeping this in one place is the point of
// this refactor: preview and the real form must never diverge on how items
// get grouped into sections.

export type SectionableFormItem = {
  type: string;
  label: string;
};

export type FormSection<T> = { title: string; items: T[] };

const DEFAULT_SECTION_TITLE = '基本項目';

/**
 * Groups a flat list of form items into sections.
 *
 * Rules (must stay in sync with historical useRecordForm/RecordDynamicSections
 * behavior):
 * - The initial section title defaults to "基本項目".
 * - A `section`-type item starts a new section (using its label as the title).
 * - An empty leading default section is not emitted if there are no items
 *   before the first explicit section.
 * - When a new `section` item is encountered, the section being closed is
 *   only pushed if it has items — an explicit section with zero items that
 *   is immediately followed by another section item is dropped.
 * - The final (last) section is pushed even if it has zero items, as long
 *   as it isn't the untouched leading default section.
 */
export function groupFormSections<T extends SectionableFormItem>(items: readonly T[]): FormSection<T>[] {
  const sections: FormSection<T>[] = [];
  let currentSection: FormSection<T> = { title: DEFAULT_SECTION_TITLE, items: [] };
  items.forEach((item) => {
    if (item.type === 'section') {
      if (currentSection.items.length > 0) sections.push(currentSection);
      currentSection = { title: item.label, items: [] };
    } else {
      currentSection.items.push(item);
    }
  });
  if (currentSection.items.length > 0 || currentSection.title !== DEFAULT_SECTION_TITLE) sections.push(currentSection);
  return sections;
}
