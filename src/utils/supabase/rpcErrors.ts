import 'server-only';

import type { ActionErrorCode } from '@/types/actionResult';
import { ExpectedActionError, sanitizeDbError } from '@/utils/errors';

type RpcErrorContract = {
  databaseCode: string;
  databaseMessage: string;
  code: Exclude<ActionErrorCode, 'UNEXPECTED_ERROR'>;
  message: string;
};

/** Match documented RPC identifiers exactly; never publish any database text. */
export function sanitizeRpcError(error: { code?: string; message?: string }, context: string, contracts: readonly RpcErrorContract[]): Error {
  const contract = contracts.find(item => item.databaseCode === error.code && item.databaseMessage === error.message);
  return contract ? new ExpectedActionError(contract.code, contract.message) : sanitizeDbError(error, context);
}
