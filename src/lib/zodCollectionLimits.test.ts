import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('oversized constrained collections stop before item validation', () => {
  it.each(['array', 'set'] as const)('caps %s work and preserves valid inputs', kind => {
    let visits = 0;
    const item = z.string().refine(value => {
      visits++;
      return value.startsWith('allowed-');
    });
    const values = Array.from({ length: 1000 }, (_, index) => `invalid-${index}`);
    const control = ['allowed-first', 'allowed-second'];
    const schema = kind === 'array' ? z.array(item).max(2) : z.set(item).max(2);
    const result = schema.safeParse(kind === 'array' ? values : new Set(values));
    expect(result.success).toBe(false);
    expect(visits).toBe(0);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].code).toBe('too_big');
    }
    const valid = kind === 'array' ? control : new Set(control);
    expect(schema.parse(valid)).toEqual(valid);
    expect(visits).toBe(2);
  });
});
