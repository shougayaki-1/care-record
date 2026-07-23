import 'server-only';

// GCP Cloud Logging の構造化ログ規約に準拠したロガー。
// stdout/stderr に1行1JSONを出力し、`logging.googleapis.com/labels` で
// organization_id 等をラベル化することで Cloud Logging 側の labels.<key> フィルタで
// テナントスコープの絞り込みが可能になる（listCloudLogEntries が利用）。

export type LogSeverity = 'DEFAULT' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export type LogContext = {
    organizationId?: string | null;
    userId?: string | null;
    context?: string;
};

export function log(severity: LogSeverity, message: string, meta: LogContext & Record<string, unknown> = {}): void {
    const { organizationId, userId, context, ...rest } = meta;
    const labels: Record<string, string> = {};
    if (organizationId) labels.organization_id = organizationId;
    if (userId) labels.user_id = userId;
    if (context) labels.context = context;

    const entry = {
        severity,
        message,
        ...rest,
        'logging.googleapis.com/labels': labels,
    };
    const line = JSON.stringify(entry);
    if (severity === 'ERROR' || severity === 'CRITICAL') {
        process.stderr.write(line + '\n');
    } else {
        process.stdout.write(line + '\n');
    }
}

export function logInfo(message: string, meta?: LogContext & Record<string, unknown>): void {
    log('INFO', message, meta);
}

export function logWarn(message: string, meta?: LogContext & Record<string, unknown>): void {
    log('WARNING', message, meta);
}

export function logError(message: string, meta?: LogContext & Record<string, unknown>): void {
    log('ERROR', message, meta);
}

/** Error は JSON.stringify すると空オブジェクトになるため、message/stack を明示的に取り出す。 */
export function serializeError(err: unknown): { message: string; stack?: string } | unknown {
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack };
    }
    return err;
}
