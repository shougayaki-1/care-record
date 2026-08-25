import { describe, expect, it } from 'vitest';
import { shouldShowDetailInput } from './formDetail';

describe('shouldShowDetailInput', () => {
  it('hasDetail=false → false', () => {
    expect(shouldShowDetailInput({ type: 'checkbox', hasDetail: false }, true)).toBe(false);
  });

  it('always + checkbox false → true', () => {
    expect(shouldShowDetailInput({ type: 'checkbox', hasDetail: true, detailMode: 'always' }, false)).toBe(true);
  });

  it('always + value undefined → true', () => {
    expect(shouldShowDetailInput({ type: 'number', hasDetail: true, detailMode: 'always' }, undefined)).toBe(true);
  });

  it('conditional checkbox true → true', () => {
    expect(shouldShowDetailInput({ type: 'checkbox', hasDetail: true, detailMode: 'conditional' }, true)).toBe(true);
  });

  it('conditional checkbox false → false', () => {
    expect(shouldShowDetailInput({ type: 'checkbox', hasDetail: true, detailMode: 'conditional' }, false)).toBe(false);
  });

  it('conditional select "朝" → true', () => {
    expect(shouldShowDetailInput({ type: 'select', hasDetail: true, detailMode: 'conditional' }, '朝')).toBe(true);
  });

  it('conditional select "" → false', () => {
    expect(shouldShowDetailInput({ type: 'select', hasDetail: true, detailMode: 'conditional' }, '')).toBe(false);
  });

  it('conditional multicheckbox ["朝"] → true', () => {
    expect(shouldShowDetailInput({ type: 'multicheckbox', hasDetail: true, detailMode: 'conditional' }, ['朝'])).toBe(true);
  });

  it('conditional multicheckbox [] → false', () => {
    expect(shouldShowDetailInput({ type: 'multicheckbox', hasDetail: true, detailMode: 'conditional' }, [])).toBe(false);
  });

  it('conditional text "メモ" → true', () => {
    expect(shouldShowDetailInput({ type: 'text', hasDetail: true, detailMode: 'conditional' }, 'メモ')).toBe(true);
  });

  it('conditional text "   " → false (trims)', () => {
    expect(shouldShowDetailInput({ type: 'text', hasDetail: true, detailMode: 'conditional' }, '   ')).toBe(false);
  });

  it('conditional number 0 → true', () => {
    expect(shouldShowDetailInput({ type: 'number', hasDetail: true, detailMode: 'conditional' }, 0)).toBe(true);
  });

  it('conditional number "" → false', () => {
    expect(shouldShowDetailInput({ type: 'number', hasDetail: true, detailMode: 'conditional' }, '')).toBe(false);
  });

  it('conditional time "10:30" → true', () => {
    expect(shouldShowDetailInput({ type: 'time', hasDetail: true, detailMode: 'conditional' }, '10:30')).toBe(true);
  });

  it('detailMode undefined → behaves as conditional', () => {
    expect(shouldShowDetailInput({ type: 'checkbox', hasDetail: true }, true)).toBe(true);
    expect(shouldShowDetailInput({ type: 'checkbox', hasDetail: true }, false)).toBe(false);
  });

  it('section → false', () => {
    expect(shouldShowDetailInput({ type: 'section', hasDetail: true, detailMode: 'always' }, undefined)).toBe(false);
  });

  it('CRITICAL regression: multicheckbox options without "他", conditional, detailMode undefined, value ["朝"] → true', () => {
    const item = { type: 'multicheckbox' as const, hasDetail: true, options: '朝,昼,晩' };
    expect(shouldShowDetailInput(item, ['朝'])).toBe(true);
  });
});
