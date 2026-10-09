import { expect, it, vi } from 'vitest';
import { ExpectedActionError } from '@/utils/errors';
import { sanitizeRpcError } from './rpcErrors';
vi.mock('@/utils/log', () => ({ logError: vi.fn(), serializeError: (error: unknown) => error }));
const contracts = [{ databaseCode: 'P0001', databaseMessage: 'report_image_limit_exceeded', code: 'VALIDATION_ERROR' as const, message: '画像は1記録あたり20件までです' }];
it('only classifies an exact identifier/code pair, with an application-owned message', () => {
  const error = sanitizeRpcError({ code: 'P0001', message: 'report_image_limit_exceeded' }, 'reserve', contracts);
  expect(error).toBeInstanceOf(ExpectedActionError);
  expect(error.message).toBe('画像は1記録あたり20件までです');
});
it.each([
  { code: 'P0001', message: 'report_image_limit_exceeded: private SQL' },
  { code: '42P01', message: 'report_image_limit_exceeded' },
  { message: 'report_image_limit_exceeded' },
])('keeps an unrecognized database error unexpected: %j', error => {
  const result = sanitizeRpcError(error, 'reserve', contracts);
  expect(result).not.toBeInstanceOf(ExpectedActionError);
  expect(result.message).toBe('処理に失敗しました。時間をおいて再度お試しください。');
});
