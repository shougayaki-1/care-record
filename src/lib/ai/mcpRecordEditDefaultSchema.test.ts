import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import template from '../../../supabase/functions/_shared/default-form-template.json';

it('keeps the app, MCP, and record-edit database fallback schemas aligned', () => {
  const migrations = resolve(process.cwd(), 'supabase/migrations');
  const migration = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort().reverse()
    .map(name => readFileSync(resolve(migrations, name), 'utf8'))
    .find(content => /(?:create|replace)\s+function\s+private\.mcp_record_edit_default_schema/i.test(content) && content.includes('$mcp_schema$'));
  expect(migration).toBeDefined();
  const match = migration!.match(/\$mcp_schema\$([\s\S]*?)\$mcp_schema\$/);
  expect(match).not.toBeNull();
  expect(JSON.parse(match![1])).toEqual(template);
  expect(template).toEqual(DEFAULT_TEMPLATE);
});
