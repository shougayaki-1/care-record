// src/utils/formDetail.ts
//
// Single source of truth for whether a form item's "detail" input should be
// shown, given the item's settings and the current answer value. See
// FormItem in src/constants/formTemplates.ts / src/hooks/useRecordForm.ts
// for the shape of `item`.

export type FormDetailItemType = 'text' | 'number' | 'checkbox' | 'time' | 'select' | 'multicheckbox' | 'section';

export type FormDetailItem = {
  type: FormDetailItemType;
  hasDetail?: boolean;
  detailMode?: 'conditional' | 'always';
};

export type FormDetailValue = string | number | boolean | string[] | undefined;

/**
 * Whether the main question currently has a "meaningful answer" — i.e. an
 * answer specific enough to justify showing a detail/supplement field in
 * 'conditional' mode. Sections never have a meaningful answer (no detail
 * field applies to them).
 */
export function hasMeaningfulAnswer(item: FormDetailItem, value: FormDetailValue): boolean {
  switch (item.type) {
    case 'checkbox':
      return value === true;
    case 'multicheckbox':
      return Array.isArray(value) && value.length >= 1;
    case 'select':
      return typeof value === 'string' && value.trim() !== '';
    case 'text':
      return typeof value === 'string' && value.trim() !== '';
    case 'number':
      return value !== undefined && value !== null && String(value).trim() !== '';
    case 'time':
      return typeof value === 'string' && value.trim() !== '';
    case 'section':
      return false;
    default:
      return false;
  }
}

/**
 * Whether the detail/supplement input should be rendered for this item,
 * given the current main-question value.
 *
 * - hasDetail=false            → never
 * - hasDetail=true + 'always'  → always
 * - hasDetail=true + 'conditional' (or detailMode undefined, for backward
 *   compat with existing schemas) → only when the main answer is meaningful
 * - type === 'section'         → never (sections have no detail field)
 */
export function shouldShowDetailInput(item: FormDetailItem, value: FormDetailValue): boolean {
  if (item.type === 'section') return false;
  if (!item.hasDetail) return false;
  if (item.detailMode === 'always') return true;
  // detailMode === 'conditional' or undefined → treat as conditional.
  return hasMeaningfulAnswer(item, value);
}
