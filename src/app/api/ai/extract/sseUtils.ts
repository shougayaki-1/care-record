/**
 * SSE (Server-Sent Events) フォーマットユーティリティ
 *
 * このファイルはサーバー依存なし（テスト可能）
 */

/**
 * SSE イベントをフォーマットする。
 * 形式: `event: <name>\ndata: <json>\n\n`
 */
export function formatSseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
