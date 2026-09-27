import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import mcpTemplate from '../../../supabase/functions/_shared/default-form-template.json';

describe('MCP form template', () => {
  it('stays identical to the form used by the application', () => {
    expect(mcpTemplate).toEqual(DEFAULT_TEMPLATE);
  });
});
